import type {
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
} from '../domain/ports/conversation-owner-lease-repository.js';
import type {
  ConversationWorkNotificationInput,
  ConversationWorkNotificationPublisher,
} from '../domain/ports/conversation-work-notifier.js';

const CONVERSATION_WORK_NOTIFICATION_CLAIM_REASON =
  'conversation_work_notification_publish';

interface OwnerClaimingConversationWorkPublisherInput {
  instanceId: string;
  leaseTtlMs: number;
  claimLease: (
    input: ClaimConversationOwnerLeaseInput,
  ) => Promise<ClaimConversationOwnerLeaseResult>;
  notify: ConversationWorkNotificationPublisher;
  now?: () => Date;
  logger?: {
    warn: (context: Record<string, unknown>, message: string) => void;
  };
}

export function createOwnerClaimingConversationWorkPublisher(
  input: OwnerClaimingConversationWorkPublisherInput,
): ConversationWorkNotificationPublisher {
  const currentTime = input.now ?? (() => new Date());
  return async (
    notification: ConversationWorkNotificationInput,
  ): Promise<void> => {
    let claim: ClaimConversationOwnerLeaseResult;
    try {
      claim = await input.claimLease({
        appId: notification.appId,
        conversationId: notification.conversationId,
        threadId: notification.threadId ?? null,
        ownerInstanceId: input.instanceId,
        leaseTtlMs: input.leaseTtlMs,
        now: currentTime(),
        reason: CONVERSATION_WORK_NOTIFICATION_CLAIM_REASON,
      });
    } catch (err) {
      input.logger?.warn(
        {
          err,
          appId: notification.appId,
          conversationId: notification.conversationId,
          threadId: notification.threadId ?? null,
          messageId: notification.messageId,
        },
        'Failed to claim conversation work before notification; reconciler must recover persisted work',
      );
      return;
    }

    await input.notify({
      ...notification,
      threadId: notification.threadId ?? claim.lease.threadId,
      ownerInstanceId: claim.lease.ownerInstanceId,
      leaseVersion: claim.lease.leaseVersion,
      leaseExpiresAt: claim.lease.leaseExpiresAt,
    });
  };
}
