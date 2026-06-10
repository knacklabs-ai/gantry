import { RUNTIME_EVENT_TYPES } from '../../../../domain/events/runtime-event-types.js';
import type { AgentRunnerRuntimeEventOutput } from './types.js';

/**
 * Account-pressure snapshot extracted from the SDK's `rate_limit_event`.
 * Persisted per session so every latency/quality observation carries its
 * rate-limit context (model rounds run 2-4x slower near the window cap).
 */
export interface SdkRateLimitSnapshot {
  status?: string;
  rateLimitType?: string;
  utilization?: number;
  surpassedThreshold?: number;
  resetsAt?: number;
  isUsingOverage?: boolean;
}

export function sdkRateLimitSnapshot(
  message: unknown,
): SdkRateLimitSnapshot | null {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as {
    type?: string;
    rate_limit_info?: unknown;
  };
  if (candidate.type !== 'rate_limit_event') return null;
  const info = candidate.rate_limit_info;
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  const record = info as Record<string, unknown>;
  const snapshot: SdkRateLimitSnapshot = {
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.rateLimitType === 'string'
      ? { rateLimitType: record.rateLimitType }
      : {}),
    ...(typeof record.utilization === 'number'
      ? { utilization: record.utilization }
      : {}),
    ...(typeof record.surpassedThreshold === 'number'
      ? { surpassedThreshold: record.surpassedThreshold }
      : {}),
    ...(typeof record.resetsAt === 'number'
      ? { resetsAt: record.resetsAt }
      : {}),
    ...(typeof record.isUsingOverage === 'boolean'
      ? { isUsingOverage: record.isUsingOverage }
      : {}),
  };
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

export interface RateLimitEventContext {
  appId?: string;
  agentId?: string;
  runId?: string;
  jobId?: string;
  chatJid: string;
  threadId?: string;
}

export function rateLimitRuntimeEvent(
  context: RateLimitEventContext,
  snapshot: SdkRateLimitSnapshot,
  providerSessionId: string | undefined,
): AgentRunnerRuntimeEventOutput {
  return {
    ...(context.appId ? { appId: context.appId } : {}),
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.jobId ? { jobId: context.jobId } : {}),
    conversationId: context.chatJid,
    ...(context.threadId ? { threadId: context.threadId } : {}),
    actor: 'sdk',
    eventType: RUNTIME_EVENT_TYPES.MODEL_RATE_LIMIT,
    payload: {
      ...snapshot,
      ...(providerSessionId ? { providerSessionId } : {}),
    },
  };
}

export function formatRateLimitLogLine(snapshot: SdkRateLimitSnapshot): string {
  const parts: string[] = [];
  if (snapshot.status !== undefined) parts.push(`status=${snapshot.status}`);
  if (snapshot.utilization !== undefined) {
    parts.push(`utilization=${snapshot.utilization}`);
  }
  if (snapshot.surpassedThreshold !== undefined) {
    parts.push(`surpassedThreshold=${snapshot.surpassedThreshold}`);
  }
  if (snapshot.resetsAt !== undefined) {
    parts.push(`resetsAt=${snapshot.resetsAt}`);
  }
  if (snapshot.isUsingOverage !== undefined) {
    parts.push(`overage=${snapshot.isUsingOverage}`);
  }
  return `Rate limit [${snapshot.rateLimitType ?? 'unknown'}]: ${parts.join(' ')}`;
}
