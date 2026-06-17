import { describe, expect, it, vi } from 'vitest';

import type {
  ClaimConversationOwnerLeaseResult,
  ConversationOwnerLeaseRecord,
} from '@core/domain/ports/conversation-owner-lease-repository.js';
import type { NewMessage } from '@core/domain/types.js';
import { MAX_MESSAGES_PER_PROMPT } from '@core/config/index.js';
import {
  findPendingMessageWorkCandidates,
  startConversationWorkReconciler,
} from '@core/runtime/conversation-work-reconciler.js';

function makeLease(
  overrides: Partial<ConversationOwnerLeaseRecord> = {},
): ConversationOwnerLeaseRecord {
  return {
    appId: 'app:default',
    conversationId: 'wa:918097570021',
    threadId: null,
    threadKey: '',
    ownerInstanceId: 'server-a',
    workerId: null,
    leaseVersion: 1,
    leaseExpiresAt: '2026-06-17T00:00:45.000Z',
    heartbeatAt: '2026-06-17T00:00:00.000Z',
    state: 'active',
    lastClaimReason: null,
    lastError: null,
    drainingStartedAt: null,
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('conversation work reconciler', () => {
  it('discovers pending persisted messages as sanitized missed-notification candidates', async () => {
    const pendingMessage: NewMessage = {
      id: '1',
      chat_jid: 'wa:918097570021',
      sender: 'user@s.whatsapp.net',
      content: 'customer text must not appear in candidate',
      timestamp: '2026-06-17T00:00:01.000Z',
      is_from_me: false,
      message_id: 'provider-message-1',
      reply_to_message_id: null,
      reply_to_content: null,
      sender_name: 'Customer',
    };
    const getMessageThreadIds = vi.fn(async () => [null, 'thread 1']);
    const getMessagesSince = vi.fn(
      async (
        _chatJid: string,
        _cursor: string,
        _limit: number,
        options?: { threadId?: string | null },
      ) => (options?.threadId === 'thread 1' ? [pendingMessage] : []),
    );
    const getOrRecoverCursor = vi.fn(async (queueKey: string) =>
      queueKey.includes('::thread:') ? 'thread-cursor' : 'root-cursor',
    );

    const candidates = await findPendingMessageWorkCandidates({
      getConversationRoutes: () => ({
        'wa:918097570021': {
          name: 'Boondi',
          folder: 'boondi',
          trigger: '@Andy',
          added_at: '2026-06-17T00:00:00.000Z',
          requiresTrigger: false,
        },
      }),
      getOrRecoverCursor,
      messageRepository: {
        getMessageThreadIds,
        getMessagesSince,
      },
      limit: 10,
    });

    expect(getOrRecoverCursor).toHaveBeenCalledWith('wa:918097570021');
    expect(getOrRecoverCursor).toHaveBeenCalledWith(
      'wa:918097570021::thread:thread%201',
    );
    expect(getMessagesSince).toHaveBeenNthCalledWith(
      2,
      'wa:918097570021',
      'thread-cursor',
      MAX_MESSAGES_PER_PROMPT,
      { threadId: 'thread 1' },
    );
    expect(candidates).toEqual([
      {
        appId: 'default',
        conversationId: 'wa:918097570021',
        threadId: 'thread 1',
        reason: 'missed_notification',
      },
    ]);
    expect(JSON.stringify(candidates)).not.toContain(pendingMessage.content);
  });

  it('recovers pending default-agent conversations that are not currently projected as routes', async () => {
    const pendingMessage: NewMessage = {
      id: '1',
      chat_jid: 'wa:918097570099',
      sender: 'user@s.whatsapp.net',
      content: 'recover me without route',
      timestamp: '2026-06-17T00:00:01.000Z',
      is_from_me: false,
      message_id: 'provider-message-1',
      reply_to_message_id: null,
      reply_to_content: null,
      sender_name: 'Customer',
    };
    const listInboundConversationJids = vi.fn(async () => ['wa:918097570099']);
    const ensureConversationRoute = vi.fn(async () => true);
    const getMessageThreadIds = vi.fn(async () => [null]);
    const getMessagesSince = vi.fn(async () => [pendingMessage]);
    const getOrRecoverCursor = vi.fn(async () => '');

    const candidates = await findPendingMessageWorkCandidates({
      getConversationRoutes: () => ({}),
      getOrRecoverCursor,
      messageRepository: {
        getMessageThreadIds,
        getMessagesSince,
        listInboundConversationJids,
      },
      ensureConversationRoute,
      limit: 10,
    });

    expect(listInboundConversationJids).toHaveBeenCalledWith({ limit: 10 });
    expect(ensureConversationRoute).toHaveBeenCalledWith('wa:918097570099');
    expect(candidates).toEqual([
      {
        appId: 'default',
        conversationId: 'wa:918097570099',
        threadId: null,
        reason: 'missed_notification',
      },
    ]);
  });

  it('claims missed or expired work before enqueueing local processing', async () => {
    const now = new Date('2026-06-17T00:00:00.000Z');
    const findCandidates = vi.fn(async () => [
      {
        appId: 'app:default',
        conversationId: 'wa:918097570021',
        threadId: null,
        reason: 'missed_notification' as const,
      },
      {
        appId: 'app:default',
        conversationId: 'wa:918097570021',
        threadId: 'thread 1',
        reason: 'expired_owner_lease' as const,
      },
    ]);
    const claimLease = vi.fn(
      async (input): Promise<ClaimConversationOwnerLeaseResult> => ({
        acquired: true,
        lease: makeLease({
          appId: input.appId,
          conversationId: input.conversationId,
          threadId: input.threadId ?? null,
          threadKey: input.threadId ?? '',
          ownerInstanceId: input.ownerInstanceId,
          leaseExpiresAt: '2026-06-17T00:00:45.000Z',
          lastClaimReason: input.reason ?? null,
        }),
      }),
    );
    const enqueueMessageCheck = vi.fn();

    const reconciler = startConversationWorkReconciler({
      instanceId: 'server-a',
      leaseTtlMs: 45_000,
      intervalMs: 10_000,
      scanLimit: 25,
      findCandidates,
      claimLease,
      enqueueMessageCheck,
      now: () => now,
    });

    await reconciler.runOnce();
    reconciler.close();

    expect(findCandidates).toHaveBeenCalledWith({ now, limit: 25 });
    expect(claimLease).toHaveBeenNthCalledWith(1, {
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      ownerInstanceId: 'server-a',
      leaseTtlMs: 45_000,
      reason: 'conversation_work_reconciler:missed_notification',
      now,
    });
    expect(claimLease).toHaveBeenNthCalledWith(2, {
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: 'thread 1',
      ownerInstanceId: 'server-a',
      leaseTtlMs: 45_000,
      reason: 'conversation_work_reconciler:expired_owner_lease',
      now,
    });
    expect(enqueueMessageCheck).toHaveBeenCalledTimes(2);
    expect(enqueueMessageCheck).toHaveBeenNthCalledWith(1, 'wa:918097570021');
    expect(enqueueMessageCheck).toHaveBeenNthCalledWith(
      2,
      'wa:918097570021::thread:thread%201',
    );
  });

  it('does not enqueue when the ownership claim loses', async () => {
    const now = new Date('2026-06-17T00:00:00.000Z');
    const findCandidates = vi.fn(async () => [
      {
        appId: 'app:default',
        conversationId: 'wa:918097570022',
        threadId: null,
        reason: 'expired_owner_lease' as const,
      },
    ]);
    const claimLease = vi.fn(
      async (): Promise<ClaimConversationOwnerLeaseResult> => ({
        acquired: false,
        lease: makeLease({
          conversationId: 'wa:918097570022',
          ownerInstanceId: 'server-b',
        }),
      }),
    );
    const enqueueMessageCheck = vi.fn();

    const reconciler = startConversationWorkReconciler({
      instanceId: 'server-a',
      leaseTtlMs: 45_000,
      intervalMs: 10_000,
      scanLimit: 10,
      findCandidates,
      claimLease,
      enqueueMessageCheck,
      now: () => now,
    });

    await reconciler.runOnce();
    reconciler.close();

    expect(claimLease).toHaveBeenCalledTimes(1);
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
  });

  it('does not claim work when closed while a scan is in flight', async () => {
    const now = new Date('2026-06-17T00:00:00.000Z');
    type TestCandidate = {
      appId: string;
      conversationId: string;
      threadId: string | null;
      reason: 'missed_notification';
    };
    let resolveCandidates: ((candidates: TestCandidate[]) => void) | undefined;
    const findCandidates = vi.fn(
      () =>
        new Promise<TestCandidate[]>((resolve) => {
          resolveCandidates = resolve;
        }),
    );
    const claimLease = vi.fn(
      async (): Promise<ClaimConversationOwnerLeaseResult> => ({
        acquired: true,
        lease: makeLease(),
      }),
    );
    const enqueueMessageCheck = vi.fn();

    const reconciler = startConversationWorkReconciler({
      instanceId: 'server-a',
      leaseTtlMs: 45_000,
      intervalMs: 10_000,
      scanLimit: 10,
      findCandidates,
      claimLease,
      enqueueMessageCheck,
      now: () => now,
    });

    const run = reconciler.runOnce();
    await vi.waitFor(() => expect(findCandidates).toHaveBeenCalledTimes(1));

    reconciler.close();
    resolveCandidates?.([
      {
        appId: 'app:default',
        conversationId: 'wa:918097570021',
        threadId: null,
        reason: 'missed_notification',
      },
    ]);
    await run;

    expect(claimLease).not.toHaveBeenCalled();
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
  });

  it('does not enqueue work when closed while a claim is in flight', async () => {
    const now = new Date('2026-06-17T00:00:00.000Z');
    let resolveClaim:
      | ((claim: ClaimConversationOwnerLeaseResult) => void)
      | undefined;
    const findCandidates = vi.fn(async () => [
      {
        appId: 'app:default',
        conversationId: 'wa:918097570021',
        threadId: null,
        reason: 'missed_notification' as const,
      },
    ]);
    const claimLease = vi.fn(
      () =>
        new Promise<ClaimConversationOwnerLeaseResult>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const enqueueMessageCheck = vi.fn();

    const reconciler = startConversationWorkReconciler({
      instanceId: 'server-a',
      leaseTtlMs: 45_000,
      intervalMs: 10_000,
      scanLimit: 10,
      findCandidates,
      claimLease,
      enqueueMessageCheck,
      now: () => now,
    });

    const run = reconciler.runOnce();
    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(1));

    reconciler.close();
    resolveClaim?.({
      acquired: true,
      lease: makeLease(),
    });
    await run;

    expect(enqueueMessageCheck).not.toHaveBeenCalled();
  });

  it('stops its periodic scan when closed', async () => {
    vi.useFakeTimers();
    try {
      const findCandidates = vi.fn(async () => []);
      const reconciler = startConversationWorkReconciler({
        instanceId: 'server-a',
        leaseTtlMs: 45_000,
        intervalMs: 1_000,
        scanLimit: 10,
        findCandidates,
        claimLease: vi.fn(async () => ({
          acquired: true,
          lease: makeLease(),
        })),
        enqueueMessageCheck: vi.fn(),
        now: () => new Date('2026-06-17T00:00:00.000Z'),
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(findCandidates).toHaveBeenCalledTimes(1);

      reconciler.close();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(findCandidates).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
