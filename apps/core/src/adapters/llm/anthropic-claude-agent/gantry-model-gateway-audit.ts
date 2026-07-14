import type { AppId } from '../../../domain/app/app.js';
import type { RuntimeEventPublishInput } from '../../../domain/events/events.js';
import {
  isRuntimeEventConversationFkId,
  isRuntimeEventThreadFkId,
} from '../../../domain/events/runtime-event-conversation.js';
import { RUNTIME_EVENT_TYPES } from '../../../domain/events/runtime-event-types.js';
import type { ModelCredentialProvider } from '../../../domain/model-credentials/model-credentials.js';
import { logger } from '../../../infrastructure/logging/logger.js';
import { normalizeModelUsage } from '../../../shared/model-usage.js';

export interface GatewayTokenRecord {
  token: string;
  appId: AppId;
  providerId: ModelCredentialProvider;
  authMode: string;
  schemaVersion: number;
  credentialFingerprint: string;
  createdAtMs: number;
  expiresAtMs: number;
  tokenScope: string;
  agentId?: RuntimeEventPublishInput['agentId'];
  runId?: RuntimeEventPublishInput['runId'];
  apiKeyId?: string;
  apiRequestId?: string;
  jobId?: RuntimeEventPublishInput['jobId'];
  conversationId?: RuntimeEventPublishInput['conversationId'];
  threadId?: RuntimeEventPublishInput['threadId'];
}

type GatewayAudit =
  | ((event: RuntimeEventPublishInput) => Promise<unknown> | unknown)
  | undefined;

export type GatewayUseAuditInput = {
  outcome:
    | 'forwarded'
    | 'upstream_error'
    | 'credential_missing'
    | 'rate_limited';
  method: string;
  status: number;
  upstreamHost?: string;
  upstreamPath?: string;
  credentialFingerprint?: string;
  usage?: ReturnType<typeof normalizeModelUsage>;
};

export async function publishGatewayUseAudit(
  audit: GatewayAudit,
  tokenRecord: GatewayTokenRecord,
  input: GatewayUseAuditInput,
): Promise<void> {
  if (!audit) return;
  try {
    await audit({
      ...runtimeEventFields(tokenRecord),
      eventType: RUNTIME_EVENT_TYPES.CREDENTIAL_MODEL_USED,
      actor: 'gantry-model-gateway',
      payload: {
        ...gatewayPayload(tokenRecord),
        outcome: input.outcome,
        method: input.method,
        status: input.status,
        tokenIssuedAtMs: tokenRecord.createdAtMs,
        tokenExpiresAtMs: tokenRecord.expiresAtMs,
        ...(input.credentialFingerprint
          ? { credentialFingerprint: input.credentialFingerprint }
          : {}),
        ...(input.upstreamHost ? { upstreamHost: input.upstreamHost } : {}),
        ...(input.upstreamPath ? { upstreamPath: input.upstreamPath } : {}),
        usage: input.usage,
        modelAlias: input.usage?.model,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'Gantry Model Gateway usage audit failed');
  }
}

export async function publishGatewayTokenAudit(
  audit: GatewayAudit,
  tokenRecord: GatewayTokenRecord,
  outcome: 'token_issued' | 'token_rejected',
): Promise<void> {
  if (!audit) return;
  try {
    await audit({
      ...runtimeEventFields(tokenRecord),
      eventType: RUNTIME_EVENT_TYPES.CREDENTIAL_MODEL_USED,
      actor: 'gantry-model-gateway',
      payload: {
        ...gatewayPayload(tokenRecord),
        outcome,
        tokenIssuedAtMs: tokenRecord.createdAtMs,
        tokenExpiresAtMs: tokenRecord.expiresAtMs,
        credentialFingerprint: tokenRecord.credentialFingerprint,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'Gantry Model Gateway token audit failed');
  }
}

function runtimeEventFields(
  tokenRecord: GatewayTokenRecord,
): Pick<RuntimeEventPublishInput, 'appId'> &
  Partial<
    Pick<
      RuntimeEventPublishInput,
      'agentId' | 'runId' | 'jobId' | 'conversationId' | 'threadId'
    >
  > {
  const conversationId = isRuntimeEventConversationFkId(
    tokenRecord.conversationId,
  )
    ? tokenRecord.conversationId
    : undefined;
  const threadId = isRuntimeEventThreadFkId(tokenRecord.threadId)
    ? tokenRecord.threadId
    : undefined;
  const runId = runtimeEventRunIdFor(tokenRecord);
  return {
    appId: tokenRecord.appId,
    ...(tokenRecord.agentId ? { agentId: tokenRecord.agentId } : {}),
    ...(runId ? { runId } : {}),
    ...(tokenRecord.jobId ? { jobId: tokenRecord.jobId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

function gatewayPayload(
  tokenRecord: GatewayTokenRecord,
): Record<string, unknown> {
  return {
    providerId: tokenRecord.providerId,
    tokenScope: tokenRecord.tokenScope,
    ...(tokenRecord.apiKeyId ? { apiKeyId: tokenRecord.apiKeyId } : {}),
    ...(tokenRecord.conversationId
      ? { conversationJid: tokenRecord.conversationId }
      : {}),
    ...(tokenRecord.threadId ? { threadId: tokenRecord.threadId } : {}),
  };
}

function runtimeEventRunIdFor(
  tokenRecord: GatewayTokenRecord,
): RuntimeEventPublishInput['runId'] | undefined {
  if (!tokenRecord.runId) return undefined;
  const runId = String(tokenRecord.runId);
  return runId.startsWith('credential-run:') ||
    runId.startsWith('memory-query:')
    ? undefined
    : tokenRecord.runId;
}
