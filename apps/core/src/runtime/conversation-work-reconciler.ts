import type {
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
} from '../domain/ports/conversation-owner-lease-repository.js';
import type { RuntimeMessageRepository } from '../domain/repositories/ops-repo.js';
import { MAX_MESSAGES_PER_PROMPT } from '../config/index.js';
import { makeThreadQueueKey } from '../shared/thread-queue-key.js';

export const DEFAULT_CONVERSATION_WORK_RECONCILE_INTERVAL_MS = 15_000;
export const DEFAULT_CONVERSATION_WORK_RECONCILE_LIMIT = 100;

export type ConversationWorkReconcileReason =
  | 'missed_notification'
  | 'expired_owner_lease'
  | 'draining_owner_lease';

export interface ConversationWorkReconcileCandidate {
  appId: string;
  conversationId: string;
  threadId?: string | null;
  reason: ConversationWorkReconcileReason;
}

export interface ConversationWorkReconcileScanInput {
  now: Date;
  limit: number;
}

export interface StartConversationWorkReconcilerInput {
  instanceId: string;
  leaseTtlMs: number;
  intervalMs: number;
  scanLimit: number;
  findCandidates: (
    input: ConversationWorkReconcileScanInput,
  ) => Promise<ConversationWorkReconcileCandidate[]>;
  claimLease: (
    input: ClaimConversationOwnerLeaseInput,
  ) => Promise<ClaimConversationOwnerLeaseResult>;
  hasPendingWork?: (
    candidate: ConversationWorkReconcileCandidate,
  ) => Promise<boolean> | boolean;
  enqueueMessageCheck: (queueKey: string) => void;
  now?: () => Date;
  logger?: {
    warn: (context: Record<string, unknown>, message: string) => void;
  };
}

export interface ConversationWorkReconcilerHandle {
  runOnce(): Promise<void>;
  close(): void;
}

export interface FindPendingMessageWorkCandidatesInput {
  appId?: string;
  getConversationRoutes: () => Record<string, unknown>;
  getOrRecoverCursor: (queueKey: string) => Promise<string> | string;
  messageRepository: Pick<
    RuntimeMessageRepository,
    'getMessageThreadIds' | 'getMessagesSince' | 'listInboundConversationJids'
  >;
  ensureConversationRoute?: (
    conversationId: string,
  ) => Promise<boolean> | boolean;
  limit: number;
}

export async function findPendingMessageWorkCandidates(
  input: FindPendingMessageWorkCandidatesInput,
): Promise<ConversationWorkReconcileCandidate[]> {
  if (input.limit <= 0) return [];
  const appId = input.appId ?? 'default';
  const candidates: ConversationWorkReconcileCandidate[] = [];
  const routeConversationIds = new Set(
    Object.keys(input.getConversationRoutes()),
  );
  const additionalConversationIds =
    (await input.messageRepository.listInboundConversationJids?.({
      limit: input.limit,
    })) ?? [];
  for (const conversationId of additionalConversationIds) {
    if (routeConversationIds.has(conversationId)) continue;
    if (!(await input.ensureConversationRoute?.(conversationId))) continue;
    routeConversationIds.add(conversationId);
  }

  for (const conversationId of routeConversationIds) {
    const threadIds =
      await input.messageRepository.getMessageThreadIds(conversationId);
    for (const threadId of threadIds) {
      const queueKey = makeThreadQueueKey(conversationId, threadId);
      const cursor = await input.getOrRecoverCursor(queueKey);
      const pending = await input.messageRepository.getMessagesSince(
        conversationId,
        cursor,
        MAX_MESSAGES_PER_PROMPT,
        { threadId },
      );
      if (pending.length === 0) continue;
      candidates.push({
        appId,
        conversationId,
        threadId,
        reason: 'missed_notification',
      });
      if (candidates.length >= input.limit) return candidates;
    }
  }

  return candidates;
}

async function claimAndEnqueueCandidate(
  input: StartConversationWorkReconcilerInput,
  candidate: ConversationWorkReconcileCandidate,
  now: Date,
  isClosed: () => boolean,
): Promise<void> {
  const claim = await input.claimLease({
    appId: candidate.appId,
    conversationId: candidate.conversationId,
    threadId: candidate.threadId,
    ownerInstanceId: input.instanceId,
    leaseTtlMs: input.leaseTtlMs,
    now,
    reason: `conversation_work_reconciler:${candidate.reason}`,
  });
  if (isClosed()) return;
  if (!claim.acquired) return;
  if (input.hasPendingWork && !(await input.hasPendingWork(candidate))) return;
  if (isClosed()) return;
  input.enqueueMessageCheck(
    makeThreadQueueKey(candidate.conversationId, candidate.threadId),
  );
}

export function startConversationWorkReconciler(
  input: StartConversationWorkReconcilerInput,
): ConversationWorkReconcilerHandle {
  const currentTime = input.now ?? (() => new Date());
  let closed = false;
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (closed || running) return;
    running = true;
    const now = currentTime();
    try {
      const candidates = await input.findCandidates({
        now,
        limit: input.scanLimit,
      });
      if (closed) return;
      for (const candidate of candidates) {
        if (closed) return;
        try {
          await claimAndEnqueueCandidate(input, candidate, now, () => closed);
        } catch (err) {
          input.logger?.warn(
            {
              err,
              appId: candidate.appId,
              conversationId: candidate.conversationId,
              threadId: candidate.threadId,
              reason: candidate.reason,
            },
            'Failed to reconcile conversation work candidate',
          );
        }
      }
    } catch (err) {
      input.logger?.warn(
        { err },
        'Failed to scan for missed conversation work',
      );
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void runOnce();
  }, input.intervalMs);
  interval.unref?.();

  return {
    runOnce,
    close: () => {
      closed = true;
      clearInterval(interval);
    },
  };
}
