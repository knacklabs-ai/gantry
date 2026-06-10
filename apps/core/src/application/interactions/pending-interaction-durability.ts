import type {
  RunLease,
  PendingInteractionKind,
  PendingInteractionRepository,
  RunLeaseRepository,
  TransientGrantRepository,
} from '../../domain/ports/worker-coordination.js';
import { nowMs, parseIso, toIso } from '../../shared/time/datetime.js';

const DEFAULT_INTERACTION_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_APP_ID = 'default';

type InteractionDurabilityRepository = PendingInteractionRepository &
  RunLeaseRepository &
  TransientGrantRepository;

interface InteractionDurabilityBackend {
  repository: InteractionDurabilityRepository;
  warn?: (context: Record<string, unknown>, message: string) => void;
}

let backend: InteractionDurabilityBackend | null = null;

/**
 * Wired by the storage runtime when Postgres comes up. Without a backend the
 * durability hooks no-op (storage-less local fallback).
 */
export function configurePendingInteractionDurability(
  next: InteractionDurabilityBackend | null,
): void {
  backend = next;
}

export function pendingInteractionIdempotencyKey(input: {
  kind: PendingInteractionKind;
  sourceAgentFolder: string;
  requestId: string;
}): string {
  return [input.kind, input.sourceAgentFolder, input.requestId].join(':');
}

/**
 * Durable record for a permission/question prompt, created BEFORE the
 * provider prompt renders. Survives provider and control-plane restarts: the
 * idempotency key makes a restart-driven re-prompt reuse the same record.
 */
export async function recordPendingInteractionRequested(input: {
  kind: PendingInteractionKind;
  sourceAgentFolder: string;
  requestId: string;
  appId?: string | null;
  runId?: string | null;
  runLeaseToken?: string | null;
  runLeaseFencingVersion?: number | null;
  payload: Record<string, unknown>;
  callbackRoute?: Record<string, unknown> | null;
  ttlMs?: number;
}): Promise<void> {
  const active = backend;
  if (!active) return;
  try {
    await active.repository.createPendingInteraction({
      id: globalThis.crypto.randomUUID(),
      appId: input.appId || DEFAULT_APP_ID,
      runId: input.runId ?? null,
      kind: input.kind,
      payload: {
        ...input.payload,
        ...(input.runLeaseToken ? { runLeaseToken: input.runLeaseToken } : {}),
        ...(typeof input.runLeaseFencingVersion === 'number'
          ? { runLeaseFencingVersion: input.runLeaseFencingVersion }
          : {}),
      },
      callbackRoute: input.callbackRoute ?? null,
      idempotencyKey: pendingInteractionIdempotencyKey(input),
      expiresAt: toIso(nowMs() + (input.ttlMs ?? DEFAULT_INTERACTION_TTL_MS)),
    });
  } catch (err) {
    active.warn?.(
      { err, kind: input.kind, requestId: input.requestId },
      'Failed to record durable pending interaction',
    );
    throw err;
  }
}

export async function resolvePendingInteractionRecord(input: {
  kind: PendingInteractionKind;
  sourceAgentFolder: string;
  requestId: string;
  status: 'resolved' | 'cancelled';
  resolution: Record<string, unknown>;
  approverRef?: string | null;
}): Promise<void> {
  const active = backend;
  if (!active) return;
  try {
    await active.repository.resolvePendingInteraction({
      idempotencyKey: pendingInteractionIdempotencyKey(input),
      status: input.status,
      resolution: input.resolution,
      approverRef: input.approverRef ?? null,
    });
  } catch (err) {
    active.warn?.(
      { err, kind: input.kind, requestId: input.requestId },
      'Failed to resolve durable pending interaction',
    );
  }
}

export async function isActiveRunLeaseForInteraction(input: {
  runId?: string | null;
  runLeaseToken?: string | null;
  runLeaseFencingVersion?: number | null;
}): Promise<boolean> {
  if (!input.runId) return true;
  return (await activeRunLeaseForInteraction(input)) !== null;
}

async function activeRunLeaseForInteraction(input: {
  runId?: string | null;
  runLeaseToken?: string | null;
  runLeaseFencingVersion?: number | null;
}): Promise<RunLease | null> {
  if (!input.runId) return null;
  if (
    !input.runLeaseToken ||
    typeof input.runLeaseFencingVersion !== 'number'
  ) {
    return null;
  }
  const active = backend;
  if (!active) return null;
  try {
    const lease = await active.repository.getActiveRunLease({
      runId: input.runId,
    });
    if (
      !lease ||
      lease.leaseToken !== input.runLeaseToken ||
      lease.fencingVersion !== input.runLeaseFencingVersion
    ) {
      return null;
    }
    return lease;
  } catch (err) {
    active.warn?.(
      { err, runId: input.runId },
      'Failed to validate active run lease for interaction',
    );
    return null;
  }
}

/**
 * Transient, run-scoped authority: bound to the run's active lease and
 * expiring with it. Never written to durable permission state.
 */
export async function recordRunScopedTransientGrant(input: {
  appId?: string | null;
  runId: string;
  runLeaseToken?: string | null;
  runLeaseFencingVersion?: number | null;
  grant: Record<string, unknown>;
  expiresAtMs?: number;
}): Promise<void> {
  const active = backend;
  if (!active) return;
  try {
    const lease = await activeRunLeaseForInteraction(input);
    if (!lease) return;
    const leaseToken = input.runLeaseToken;
    if (!leaseToken) return;
    const leaseExpiryMs =
      parseIso(lease.expiresAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const expiresAtMs = Math.min(
      input.expiresAtMs ?? leaseExpiryMs,
      leaseExpiryMs,
    );
    await active.repository.createTransientGrant({
      id: globalThis.crypto.randomUUID(),
      appId: input.appId || DEFAULT_APP_ID,
      runId: input.runId,
      leaseToken,
      grant: input.grant,
      expiresAt: toIso(expiresAtMs),
    });
  } catch (err) {
    active.warn?.(
      { err, runId: input.runId },
      'Failed to record run-scoped transient grant',
    );
  }
}
