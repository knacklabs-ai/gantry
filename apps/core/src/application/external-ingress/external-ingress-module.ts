import { ApplicationError } from '../common/application-error.js';
import { JobManagementService } from '../jobs/job-management-service.js';
import type { SessionInteractionModule } from '../sessions/session-interaction-module.js';
import {
  type ExternalIngressSignaturePort,
  verifyExternalIngressRequestSignature,
} from './signature.js';

type ExternalIngressRecord = {
  ingressId: string;
  appId: string;
  name: string;
  secret: string;
  enabled: boolean;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

type ExternalIngressControlPort = {
  createExternalIngress(input: {
    appId: string;
    name: string;
    secret: string;
    enabled?: boolean;
    metadata?: unknown;
  }): Promise<ExternalIngressRecord>;
  listExternalIngresses(appId: string): Promise<ExternalIngressRecord[]>;
  getExternalIngressById(
    ingressId: string,
    appId?: string,
  ): Promise<ExternalIngressRecord | undefined>;
  updateExternalIngress(
    ingressId: string,
    appId: string,
    patch: {
      name?: string;
      secret?: string;
      enabled?: boolean;
      metadata?: unknown;
    },
  ): Promise<ExternalIngressRecord | undefined>;
  deleteExternalIngress(ingressId: string, appId: string): Promise<void>;
  reserveExternalIngressNonce(input: {
    appId: string;
    ingressId: string;
    nonce: string;
    now: string;
    expiresAt: string;
  }): Promise<{ ok: true } | { ok: false; code: 'NONCE_REPLAY' }>;
  createExternalIngressInvocation(input: {
    invocationId: string;
    appId: string;
    ingressId: string;
    idempotencyKey: string;
    nonce: string;
    requestMethod: string;
    requestPath: string;
    requestTimestamp: string;
    bodyHash: string;
    requestBody: string;
    signature: string;
    status: string;
    now: string;
    expiresAt: string;
  }): Promise<{
    created: boolean;
    row: { invocationId: string; status: string };
  }>;
  updateExternalIngressInvocation(input: {
    invocationId: string;
    status: string;
    response?: unknown;
    error?: string | null;
    now: string;
  }): Promise<void>;
  getExternalIngressInvocation(
    invocationId: string,
    appId: string,
    ingressId: string,
  ): Promise<
    | {
        invocationId: string;
        status: string;
        response: unknown;
        error: string | null;
      }
    | undefined
  >;
};

export class ExternalIngressModule {
  constructor(
    private readonly deps: {
      control: ExternalIngressControlPort;
      sessions: SessionInteractionModule;
      jobs: JobManagementService;
      now: () => string;
      createSecret: () => string;
      createInvocationId: () => string;
      signatureCrypto: ExternalIngressSignaturePort;
      consumeTriggerRateLimit?: (key: string, limit: number) => boolean;
      perAppTriggerLimit: number;
      perJobTriggerLimit: number;
    },
  ) {}

  async create(input: {
    appId: string;
    name: string;
    enabled?: boolean;
    metadata?: unknown;
  }) {
    if (!input.name.trim()) {
      throw new ApplicationError('INVALID_REQUEST', 'name is required');
    }
    const secret = this.deps.createSecret();
    const ingress = await this.deps.control.createExternalIngress({
      appId: input.appId,
      name: input.name.trim(),
      secret,
      enabled: input.enabled ?? true,
      metadata: input.metadata ?? {},
    });
    return { ...publicIngress(ingress), secret };
  }

  async list(appId: string) {
    const ingresses = await this.deps.control.listExternalIngresses(appId);
    return { ingresses: ingresses.map(publicIngress) };
  }

  async get(input: { appId: string; ingressId: string }) {
    const ingress = await this.deps.control.getExternalIngressById(
      input.ingressId,
      input.appId,
    );
    if (!ingress) throw new ApplicationError('NOT_FOUND', 'Ingress not found');
    return publicIngress(ingress);
  }

  async update(input: {
    appId: string;
    ingressId: string;
    patch: { name?: string; enabled?: boolean; metadata?: unknown };
  }) {
    const ingress = await this.deps.control.updateExternalIngress(
      input.ingressId,
      input.appId,
      input.patch,
    );
    if (!ingress) throw new ApplicationError('NOT_FOUND', 'Ingress not found');
    return publicIngress(ingress);
  }

  async rotate(input: { appId: string; ingressId: string }) {
    const secret = this.deps.createSecret();
    const ingress = await this.deps.control.updateExternalIngress(
      input.ingressId,
      input.appId,
      { secret },
    );
    if (!ingress) throw new ApplicationError('NOT_FOUND', 'Ingress not found');
    return { ...publicIngress(ingress), secret };
  }

  async delete(input: { appId: string; ingressId: string }) {
    await this.deps.control.deleteExternalIngress(input.ingressId, input.appId);
    return { deleted: true };
  }

  async invoke(input: {
    ingressId: string;
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    signature: string;
    rawBody: string;
  }) {
    const ingress = await this.deps.control.getExternalIngressById(
      input.ingressId,
    );
    if (!ingress) throw new ApplicationError('NOT_FOUND', 'Ingress not found');
    if (!ingress.enabled) {
      throw new ApplicationError('FORBIDDEN', 'Ingress is disabled');
    }
    const ok = verifyExternalIngressRequestSignature({
      crypto: this.deps.signatureCrypto,
      secret: ingress.secret,
      method: input.method,
      path: input.path,
      timestamp: input.timestamp,
      nonce: input.nonce,
      rawBody: input.rawBody,
      signature: input.signature,
    });
    if (!ok) {
      throw new ApplicationError(
        'FORBIDDEN',
        'Invalid external ingress signature',
      );
    }
    const body = parseBody(input.rawBody);
    const assertedAppId =
      typeof body.appId === 'string' && body.appId.trim()
        ? body.appId.trim()
        : null;
    if (assertedAppId && assertedAppId !== ingress.appId) {
      throw new ApplicationError(
        'FORBIDDEN',
        'Request appId does not match ingress app scope',
      );
    }
    const now = this.deps.now();
    const timestampMs = Number(input.timestamp);
    const nonceExpiry = new Date(timestampMs + 5 * 60_000).toISOString();
    const nonce = await this.deps.control.reserveExternalIngressNonce({
      appId: ingress.appId,
      ingressId: ingress.ingressId,
      nonce: input.nonce,
      now,
      expiresAt: nonceExpiry,
    });
    if (!nonce.ok) {
      throw new ApplicationError('CONFLICT', 'External ingress nonce replay');
    }
    const invocationId = this.deps.createInvocationId();
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : input.nonce;
    const bodyHash = this.deps.signatureCrypto.sha256(input.rawBody);
    const invocation = await this.deps.control.createExternalIngressInvocation({
      invocationId,
      appId: ingress.appId,
      ingressId: ingress.ingressId,
      idempotencyKey,
      nonce: input.nonce,
      requestMethod: input.method.toUpperCase(),
      requestPath: input.path,
      requestTimestamp: new Date(timestampMs).toISOString(),
      bodyHash,
      requestBody: input.rawBody,
      signature: input.signature,
      status: 'pending',
      now,
      expiresAt: addDaysIso(now, 30),
    });
    if (!invocation.created && invocation.row.status === 'pending') {
      throw new ApplicationError(
        'CONFLICT',
        'Duplicate active external ingress invocation',
      );
    }
    if (!invocation.created) {
      return {
        invocationId: invocation.row.invocationId,
        duplicate: true,
      };
    }
    try {
      const result = await this.dispatchTarget({
        appId: ingress.appId,
        invocationId,
        metadata: ingress.metadata,
        body,
      });
      await this.deps.control.updateExternalIngressInvocation({
        invocationId,
        status: 'completed',
        response: result,
        now: this.deps.now(),
      });
      return { invocationId, duplicate: false, ...result };
    } catch (error) {
      await this.deps.control.updateExternalIngressInvocation({
        invocationId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Invocation failed',
        now: this.deps.now(),
      });
      throw error;
    }
  }

  async wait(input: { ingressId: string; invocationId: string }) {
    const ingress = await this.deps.control.getExternalIngressById(
      input.ingressId,
    );
    if (!ingress) throw new ApplicationError('NOT_FOUND', 'Ingress not found');
    const invocation = await this.deps.control.getExternalIngressInvocation(
      input.invocationId,
      ingress.appId,
      ingress.ingressId,
    );
    if (!invocation) {
      throw new ApplicationError('NOT_FOUND', 'Invocation not found');
    }
    return invocation;
  }

  async signedWait(input: {
    ingressId: string;
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    signature: string;
    rawBody: string;
  }) {
    const ingress = await this.deps.control.getExternalIngressById(
      input.ingressId,
    );
    if (!ingress) throw new ApplicationError('NOT_FOUND', 'Ingress not found');
    if (!ingress.enabled) {
      throw new ApplicationError('FORBIDDEN', 'Ingress is disabled');
    }
    const ok = verifyExternalIngressRequestSignature({
      crypto: this.deps.signatureCrypto,
      secret: ingress.secret,
      method: input.method,
      path: input.path,
      timestamp: input.timestamp,
      nonce: input.nonce,
      rawBody: input.rawBody,
      signature: input.signature,
    });
    if (!ok) {
      throw new ApplicationError(
        'FORBIDDEN',
        'Invalid external ingress signature',
      );
    }
    const timestampMs = Number(input.timestamp);
    const nonce = await this.deps.control.reserveExternalIngressNonce({
      appId: ingress.appId,
      ingressId: ingress.ingressId,
      nonce: input.nonce,
      now: this.deps.now(),
      expiresAt: new Date(timestampMs + 5 * 60_000).toISOString(),
    });
    if (!nonce.ok) {
      throw new ApplicationError('CONFLICT', 'External ingress nonce replay');
    }
    const body = parseBody(input.rawBody);
    const invocationId = readString(body, 'invocationId');
    return this.wait({ ingressId: input.ingressId, invocationId });
  }

  private async dispatchTarget(input: {
    appId: string;
    invocationId: string;
    metadata: unknown;
    body: Record<string, unknown>;
  }) {
    const target = readTarget(input.body);
    assertTargetAllowed(input.metadata, target);
    if (target.kind === 'session_message') {
      return this.invokeSessionMessage(input.appId, target);
    }
    if (target.kind === 'job_trigger') {
      return this.invokeJobTrigger(input.appId, target);
    }
    if (target.kind === 'job_template') {
      return this.invokeJobTemplate(input.appId, input.metadata, target);
    }
    throw new ApplicationError('INVALID_REQUEST', 'Unsupported ingress target');
  }

  private async invokeSessionMessage(appId: string, target: IngressTarget) {
    const message = readString(target, 'message');
    let sessionId = readOptionalString(target, 'sessionId');
    if (!sessionId) {
      const conversationId = readString(target, 'conversationId');
      const ensured = await this.deps.sessions.ensureSession({
        appId,
        conversationId,
        title: readOptionalString(target, 'title'),
      });
      sessionId = ensured.session.sessionId;
    }
    const accepted = await this.deps.sessions.acceptMessage({
      appId,
      sessionId,
      message,
      senderId: readOptionalString(target, 'senderId') ?? 'external-ingress',
      senderName:
        readOptionalString(target, 'senderName') ?? 'External Ingress',
      threadId: readOptionalString(target, 'threadId') ?? undefined,
      correlationId: readOptionalString(target, 'correlationId') ?? null,
      responseMode: target.responseMode,
      webhookId: readOptionalString(target, 'webhookId'),
    });
    return {
      targetKind: 'session_message',
      sessionId,
      messageId: accepted.messageId,
      acceptedEventId: accepted.acceptedEventId,
      wait: {
        kind: 'session',
        sessionId,
        afterEventId: accepted.acceptedEventId,
      },
      enqueue: accepted.enqueue,
    };
  }

  private async invokeJobTrigger(appId: string, target: IngressTarget) {
    const jobId = readString(target, 'jobId');
    const trigger = await this.deps.jobs.triggerJob({
      appId,
      jobId,
      consumeRateLimit: this.deps.consumeTriggerRateLimit,
      perAppLimit: this.deps.perAppTriggerLimit,
      perJobLimit: this.deps.perJobTriggerLimit,
    });
    return {
      targetKind: 'job_trigger',
      jobId,
      triggerId: trigger.triggerId,
      wait: { kind: 'trigger', triggerId: trigger.triggerId },
    };
  }

  private async invokeJobTemplate(
    appId: string,
    metadata: unknown,
    target: IngressTarget,
  ) {
    const templateId = readString(target, 'templateId');
    const template = readTemplate(metadata, templateId);
    const variables = readVariables(target.variables);
    const allowed = new Set(template.allowedVariables ?? []);
    for (const key of Object.keys(variables)) {
      if (!allowed.has(key)) {
        throw new ApplicationError(
          'FORBIDDEN',
          `Variable is not allowed by job template: ${key}`,
        );
      }
    }
    const prompt = renderTemplate(template.prompt, variables);
    const created = await this.deps.jobs.createJob({
      appId,
      name: template.name,
      prompt,
      sessionId: template.sessionId,
      kind: 'once',
      runAt: this.deps.now(),
      executionMode: 'serialized',
    });
    const trigger = await this.deps.jobs.triggerJob({
      appId,
      jobId: created.jobId,
      consumeRateLimit: this.deps.consumeTriggerRateLimit,
      perAppLimit: this.deps.perAppTriggerLimit,
      perJobLimit: this.deps.perJobTriggerLimit,
    });
    return {
      targetKind: 'job_template',
      templateId,
      jobId: created.jobId,
      triggerId: trigger.triggerId,
      wait: { kind: 'trigger', triggerId: trigger.triggerId },
    };
  }
}

type IngressTarget = Record<string, unknown> & { kind: string };

function publicIngress(ingress: ExternalIngressRecord) {
  return {
    ingressId: ingress.ingressId,
    appId: ingress.appId,
    name: ingress.name,
    enabled: ingress.enabled,
    metadata: ingress.metadata,
    createdAt: ingress.createdAt,
    updatedAt: ingress.updatedAt,
  };
}

function parseBody(rawBody: string): Record<string, unknown> {
  try {
    const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new ApplicationError('INVALID_REQUEST', 'Invalid JSON body');
}

function readTarget(body: Record<string, unknown>): IngressTarget {
  const target = body.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new ApplicationError('INVALID_REQUEST', 'target is required');
  }
  const kind = (target as Record<string, unknown>).kind;
  if (typeof kind !== 'string' || !kind.trim()) {
    throw new ApplicationError('INVALID_REQUEST', 'target.kind is required');
  }
  return target as IngressTarget;
}

function addDaysIso(value: string, days: number): string {
  const time = Date.parse(value);
  const base = Number.isFinite(time) ? time : Date.now();
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function assertTargetAllowed(metadata: unknown, target: IngressTarget): void {
  const policy = readTargetPolicy(metadata);
  if (!allows(policy.targetKinds, target.kind)) {
    throw new ApplicationError(
      'FORBIDDEN',
      `Ingress is not allowed to invoke target kind: ${target.kind}`,
    );
  }
  if (target.kind === 'session_message') {
    const sessionId = readOptionalString(target, 'sessionId');
    if (sessionId && allows(policy.sessionIds, sessionId)) return;
    const conversationId = readOptionalString(target, 'conversationId');
    if (conversationId && allows(policy.conversationIds, conversationId)) {
      return;
    }
    throw new ApplicationError(
      'FORBIDDEN',
      'Ingress is not allowed to invoke this session target',
    );
  }
  if (target.kind === 'job_trigger') {
    const jobId = readOptionalString(target, 'jobId');
    if (jobId && allows(policy.jobIds, jobId)) return;
    throw new ApplicationError(
      'FORBIDDEN',
      'Ingress is not allowed to trigger this job',
    );
  }
  if (target.kind === 'job_template') {
    const templateId = readOptionalString(target, 'templateId');
    if (templateId && allows(policy.templateIds, templateId)) return;
    throw new ApplicationError(
      'FORBIDDEN',
      'Ingress is not allowed to invoke this job template',
    );
  }
}

function readTargetPolicy(metadata: unknown): {
  targetKinds: Set<string>;
  sessionIds: Set<string>;
  conversationIds: Set<string>;
  jobIds: Set<string>;
  templateIds: Set<string>;
} {
  const root =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const policy =
    root.targetPolicy &&
    typeof root.targetPolicy === 'object' &&
    !Array.isArray(root.targetPolicy)
      ? (root.targetPolicy as Record<string, unknown>)
      : {};
  return {
    targetKinds: readPolicySet(policy.allowedTargetKinds),
    sessionIds: readPolicySet(policy.sessionIds),
    conversationIds: readPolicySet(policy.conversationIds),
    jobIds: readPolicySet(policy.jobIds),
    templateIds: readPolicySet(policy.templateIds),
  };
}

function readPolicySet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function allows(allowed: Set<string>, value: string): boolean {
  return allowed.has('*') || allowed.has(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApplicationError('INVALID_REQUEST', `${key} is required`);
  }
  return value.trim();
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readVariables(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const variables: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number') {
      variables[key] = String(raw);
    }
  }
  return variables;
}

function readTemplate(
  metadata: unknown,
  templateId: string,
): {
  name: string;
  prompt: string;
  sessionId: string;
  allowedVariables?: string[];
} {
  const root =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const templates =
    root.templates && typeof root.templates === 'object'
      ? (root.templates as Record<string, unknown>)
      : {};
  const template = templates[templateId];
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new ApplicationError('NOT_FOUND', 'Job template not found');
  }
  const record = template as Record<string, unknown>;
  const allowed = Array.isArray(record.allowedVariables)
    ? record.allowedVariables.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  return {
    name: readString(record, 'name'),
    prompt: readString(record, 'prompt'),
    sessionId: readString(record, 'sessionId'),
    allowedVariables: allowed,
  };
}

function renderTemplate(
  prompt: string,
  variables: Record<string, string>,
): string {
  return prompt.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    return variables[String(key)] ?? '';
  });
}
