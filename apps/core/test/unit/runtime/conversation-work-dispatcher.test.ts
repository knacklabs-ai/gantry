import { describe, expect, it, vi } from 'vitest';

import { startConversationWorkDispatcher } from '@core/runtime/conversation-work-dispatcher.js';
import type { ConversationWorkNotification } from '@core/adapters/storage/postgres/conversation-work-notifier.postgres.js';

describe('conversation work dispatcher', () => {
  it('ignores a notification owned by another live instance', () => {
    let listener:
      | ((notification: ConversationWorkNotification) => void)
      | undefined;
    const unsubscribe = vi.fn();
    const notifier = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return unsubscribe;
      }),
    };
    const enqueueMessageCheck = vi.fn();
    const claimLease = vi.fn(async () => ({
      acquired: true,
      lease: { ownerInstanceId: 'server-a', leaseVersion: 1 },
    }));

    const dispatcher = startConversationWorkDispatcher({
      instanceId: 'server-a',
      notifier,
      claimLease,
      leaseTtlMs: 45_000,
      enqueueMessageCheck,
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:wa-existing-route',
      ownerInstanceId: 'server-b',
      leaseVersion: 42,
      leaseExpiresAt: '2026-06-17T00:00:10.000Z',
    });

    expect(enqueueMessageCheck).not.toHaveBeenCalled();
    expect(claimLease).not.toHaveBeenCalled();
    dispatcher.close();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('claims ownership before enqueueing local work', async () => {
    let listener:
      | ((notification: ConversationWorkNotification) => void)
      | undefined;
    const notifier = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    };
    const enqueueMessageCheck = vi.fn();
    const claimLease = vi.fn(async () => ({
      acquired: true,
      lease: { ownerInstanceId: 'server-a', leaseVersion: 1 },
    }));

    startConversationWorkDispatcher({
      instanceId: 'server-a',
      notifier,
      claimLease,
      leaseTtlMs: 45_000,
      enqueueMessageCheck,
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:root',
    });
    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: 'thread 1',
      messageId: 'message:wa:918097570021:thread',
      ownerInstanceId: 'server-a',
      leaseVersion: 7,
      leaseExpiresAt: '2026-06-17T00:00:10.000Z',
    });
    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570022',
      threadId: 'thread-expired',
      messageId: 'message:wa:918097570022:expired',
      ownerInstanceId: 'server-b',
      leaseVersion: 8,
      leaseExpiresAt: '2026-06-16T23:59:59.000Z',
    });

    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(3));
    expect(claimLease).toHaveBeenNthCalledWith(1, {
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      ownerInstanceId: 'server-a',
      leaseTtlMs: 45_000,
      reason: 'conversation_work_notification',
      now: new Date('2026-06-17T00:00:00.000Z'),
    });
    expect(claimLease).toHaveBeenNthCalledWith(2, {
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: 'thread 1',
      ownerInstanceId: 'server-a',
      leaseTtlMs: 45_000,
      reason: 'conversation_work_notification',
      now: new Date('2026-06-17T00:00:00.000Z'),
    });
    expect(enqueueMessageCheck).toHaveBeenCalledTimes(3);
    expect(enqueueMessageCheck).toHaveBeenNthCalledWith(1, 'wa:918097570021');
    expect(enqueueMessageCheck).toHaveBeenNthCalledWith(
      2,
      'wa:918097570021::thread:thread%201',
    );
    expect(enqueueMessageCheck).toHaveBeenNthCalledWith(
      3,
      'wa:918097570022::thread:thread-expired',
    );
  });

  it('does not enqueue local work when database ownership claim loses', async () => {
    let listener:
      | ((notification: ConversationWorkNotification) => void)
      | undefined;
    const notifier = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    };
    const enqueueMessageCheck = vi.fn();
    const claimLease = vi.fn(async () => ({
      acquired: false,
      lease: { ownerInstanceId: 'server-b', leaseVersion: 4 },
    }));

    startConversationWorkDispatcher({
      instanceId: 'server-a',
      notifier,
      claimLease,
      leaseTtlMs: 45_000,
      enqueueMessageCheck,
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:root',
    });

    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(1));
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
  });

  it('ignores an in-flight notification callback after close', async () => {
    let listener:
      | ((notification: ConversationWorkNotification) => void)
      | undefined;
    const notifier = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    };
    const enqueueMessageCheck = vi.fn();
    const claimLease = vi.fn(async () => ({
      acquired: true,
      lease: { ownerInstanceId: 'server-a', leaseVersion: 1 },
    }));

    const dispatcher = startConversationWorkDispatcher({
      instanceId: 'server-a',
      notifier,
      claimLease,
      leaseTtlMs: 45_000,
      enqueueMessageCheck,
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });
    dispatcher.close();

    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:late',
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(claimLease).not.toHaveBeenCalled();
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
  });

  it('does not enqueue when closed while an ownership claim is in flight', async () => {
    let listener:
      | ((notification: ConversationWorkNotification) => void)
      | undefined;
    let resolveClaim:
      | ((claim: {
          acquired: true;
          lease: { ownerInstanceId: string; leaseVersion: number };
        }) => void)
      | undefined;
    const notifier = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    };
    const enqueueMessageCheck = vi.fn();
    const claimLease = vi.fn(
      () =>
        new Promise<{
          acquired: true;
          lease: { ownerInstanceId: string; leaseVersion: number };
        }>((resolve) => {
          resolveClaim = resolve;
        }),
    );

    const dispatcher = startConversationWorkDispatcher({
      instanceId: 'server-a',
      notifier,
      claimLease,
      leaseTtlMs: 45_000,
      enqueueMessageCheck,
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    listener?.({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:late-claim',
    });
    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(1));

    dispatcher.close();
    resolveClaim?.({
      acquired: true,
      lease: { ownerInstanceId: 'server-a', leaseVersion: 1 },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(enqueueMessageCheck).not.toHaveBeenCalled();
  });
});
