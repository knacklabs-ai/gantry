import type { ConversationWorkNotification } from '../adapters/storage/postgres/conversation-work-notifier.postgres.js';
import type {
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
} from '../domain/ports/conversation-owner-lease-repository.js';
import { makeThreadQueueKey } from '../shared/thread-queue-key.js';

interface ConversationWorkNotifier {
  subscribe(
    listener: (notification: ConversationWorkNotification) => void,
  ): () => void;
}

export const DEFAULT_CONVERSATION_OWNER_LEASE_TTL_MS = 45_000;

interface ConversationWorkDispatcherInput {
  instanceId: string;
  notifier: ConversationWorkNotifier;
  claimLease: (
    input: ClaimConversationOwnerLeaseInput,
  ) => Promise<ClaimConversationOwnerLeaseResult>;
  leaseTtlMs: number;
  enqueueMessageCheck: (queueKey: string) => void;
  now?: () => Date;
  logger?: {
    warn: (context: Record<string, unknown>, message: string) => void;
  };
}

export interface ConversationWorkDispatcherHandle {
  close(): void;
}

function hasDifferentLiveOwner(
  notification: ConversationWorkNotification,
  instanceId: string,
  now: Date,
): boolean {
  if (!notification.ownerInstanceId) return false;
  if (notification.ownerInstanceId === instanceId) return false;
  if (!notification.leaseExpiresAt) return false;
  const expiresAtMs = Date.parse(notification.leaseExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs > now.getTime();
}

export function startConversationWorkDispatcher(
  input: ConversationWorkDispatcherInput,
): ConversationWorkDispatcherHandle {
  const currentTime = input.now ?? (() => new Date());
  let closed = false;
  const handleNotification = async (
    notification: ConversationWorkNotification,
  ): Promise<void> => {
    if (closed) return;
    const now = currentTime();
    if (hasDifferentLiveOwner(notification, input.instanceId, now)) {
      return;
    }
    const claim = await input.claimLease({
      appId: notification.appId,
      conversationId: notification.conversationId,
      threadId: notification.threadId,
      ownerInstanceId: input.instanceId,
      leaseTtlMs: input.leaseTtlMs,
      now,
      reason: 'conversation_work_notification',
    });
    if (closed) return;
    if (!claim.acquired) return;
    input.enqueueMessageCheck(
      makeThreadQueueKey(notification.conversationId, notification.threadId),
    );
  };

  const unsubscribe = input.notifier.subscribe((notification) => {
    void handleNotification(notification).catch((err) => {
      input.logger?.warn(
        {
          err,
          appId: notification.appId,
          conversationId: notification.conversationId,
          threadId: notification.threadId,
          messageId: notification.messageId,
        },
        'Failed to claim conversation work notification; reconciler must recover persisted work',
      );
    });
  });
  return {
    close: () => {
      closed = true;
      unsubscribe();
    },
  };
}
