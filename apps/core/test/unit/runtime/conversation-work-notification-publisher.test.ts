import { describe, expect, it, vi } from 'vitest';

import { createOwnerClaimingConversationWorkPublisher } from '@core/runtime/conversation-work-notification-publisher.js';
import type {
  ConversationOwnerLeaseRecord,
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
} from '@core/domain/ports/conversation-owner-lease-repository.js';
import type { ConversationWorkNotificationInput } from '@core/domain/ports/conversation-work-notifier.js';
import type { AppId } from '@core/domain/app/app.js';

const APP_ID = 'app:default' as AppId;

function lease(
  overrides: Partial<ConversationOwnerLeaseRecord> = {},
): ConversationOwnerLeaseRecord {
  return {
    appId: APP_ID,
    conversationId: 'wa:918097570021',
    threadId: 'thread-1',
    threadKey: 'thread-1',
    ownerInstanceId: 'runtime:1',
    workerId: null,
    leaseVersion: 7,
    leaseExpiresAt: '2026-06-17T02:31:45.000Z',
    heartbeatAt: '2026-06-17T02:31:00.000Z',
    state: 'active',
    lastClaimReason: 'conversation_work_notification_publish',
    lastError: null,
    drainingStartedAt: null,
    createdAt: '2026-06-17T02:31:00.000Z',
    updatedAt: '2026-06-17T02:31:00.000Z',
    ...overrides,
  };
}

describe('createOwnerClaimingConversationWorkPublisher', () => {
  it('claims conversation ownership before publishing the doorbell with owner hints', async () => {
    const operations: string[] = [];
    const now = new Date('2026-06-17T02:31:00.000Z');
    const claimLease = vi.fn(
      async (
        input: ClaimConversationOwnerLeaseInput,
      ): Promise<ClaimConversationOwnerLeaseResult> => {
        operations.push('claim');
        expect(input).toMatchObject({
          appId: APP_ID,
          conversationId: 'wa:918097570021',
          threadId: 'thread-1',
          ownerInstanceId: 'runtime:1',
          leaseTtlMs: 45_000,
          now,
          reason: 'conversation_work_notification_publish',
        });
        return { acquired: true, lease: lease() };
      },
    );
    const notify = vi.fn(async (_input: ConversationWorkNotificationInput) => {
      operations.push('notify');
    });
    const publisher = createOwnerClaimingConversationWorkPublisher({
      instanceId: 'runtime:1',
      leaseTtlMs: 45_000,
      claimLease,
      notify,
      now: () => now,
    });

    await publisher({
      appId: APP_ID,
      conversationId: 'wa:918097570021',
      threadId: 'thread-1',
      messageId: 'message:1',
    });

    expect(operations).toEqual(['claim', 'notify']);
    expect(notify).toHaveBeenCalledWith({
      appId: APP_ID,
      conversationId: 'wa:918097570021',
      threadId: 'thread-1',
      messageId: 'message:1',
      ownerInstanceId: 'runtime:1',
      leaseVersion: 7,
      leaseExpiresAt: '2026-06-17T02:31:45.000Z',
    });
  });

  it('publishes the current owner hint when another live owner already holds the lease', async () => {
    const claimLease = vi.fn(async () => ({
      acquired: false,
      lease: lease({
        ownerInstanceId: 'runtime:other',
        leaseVersion: 9,
        leaseExpiresAt: '2026-06-17T02:32:00.000Z',
      }),
    }));
    const notify = vi.fn(async () => undefined);
    const publisher = createOwnerClaimingConversationWorkPublisher({
      instanceId: 'runtime:1',
      leaseTtlMs: 45_000,
      claimLease,
      notify,
      now: () => new Date('2026-06-17T02:31:00.000Z'),
    });

    await publisher({
      appId: APP_ID,
      conversationId: 'wa:918097570021',
      threadId: 'thread-1',
      messageId: 'message:1',
    });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerInstanceId: 'runtime:other',
        leaseVersion: 9,
        leaseExpiresAt: '2026-06-17T02:32:00.000Z',
      }),
    );
  });

  it('does not publish when the owner claim fails before notification', async () => {
    const warn = vi.fn();
    const claimLease = vi.fn(async () => {
      throw new Error('claim unavailable');
    });
    const notify = vi.fn(async () => undefined);
    const publisher = createOwnerClaimingConversationWorkPublisher({
      instanceId: 'runtime:1',
      leaseTtlMs: 45_000,
      claimLease,
      notify,
      now: () => new Date('2026-06-17T02:31:00.000Z'),
      logger: { warn },
    });

    await publisher({
      appId: APP_ID,
      conversationId: 'wa:918097570021',
      threadId: 'thread-1',
      messageId: 'message:1',
    });

    expect(notify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        conversationId: 'wa:918097570021',
        threadId: 'thread-1',
        messageId: 'message:1',
      }),
      'Failed to claim conversation work before notification; reconciler must recover persisted work',
    );
  });
});
