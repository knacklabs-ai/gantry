import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_WORK_CHANNEL,
  parseConversationWorkNotification,
  PostgresConversationWorkNotifier,
} from '@core/adapters/storage/postgres/conversation-work-notifier.postgres.js';

class FakeListenClient extends EventEmitter {
  readonly query = vi.fn(async () => undefined);
  readonly release = vi.fn();
}

describe('PostgresConversationWorkNotifier', () => {
  it('publishes sanitized conversation work wakeups on a dedicated channel', async () => {
    const pool = {
      query: vi.fn(async () => undefined),
    };
    const notifier = new PostgresConversationWorkNotifier(pool as never);

    await notifier.notify({
      appId: 'app:default' as never,
      conversationId: 'wa:918097570021',
      threadId: 'thread-1',
      messageId: 'message:wa:918097570021:wa-existing-route',
      ownerInstanceId: 'server-b',
      leaseVersion: 42,
      leaseExpiresAt: '2026-06-17T00:00:00.000Z',
    });

    expect(pool.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      CONVERSATION_WORK_CHANNEL,
      expect.any(String),
    ]);
    const payload = String(pool.query.mock.calls[0]?.[1]?.[1]);
    expect(JSON.parse(payload)).toEqual({
      app_id: 'app:default',
      conversation_id: 'wa:918097570021',
      thread_id: 'thread-1',
      message_id: 'message:wa:918097570021:wa-existing-route',
      owner_instance_id: 'server-b',
      lease_version: 42,
      lease_expires_at: '2026-06-17T00:00:00.000Z',
    });
    expect(payload).not.toContain('content');
    expect(payload).not.toContain('prompt');
  });

  it('parses only valid conversation work wakeups', () => {
    expect(
      parseConversationWorkNotification(
        JSON.stringify({
          app_id: 'app:default',
          conversation_id: 'wa:918097570021',
          thread_id: null,
          message_id: 'message:wa:918097570021:wa-existing-route',
        }),
      ),
    ).toEqual({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:wa-existing-route',
    });
    expect(parseConversationWorkNotification('{')).toBeNull();
    expect(
      parseConversationWorkNotification(
        JSON.stringify({
          app_id: 'app:default',
          conversation_id: 'wa:918097570021',
        }),
      ),
    ).toBeNull();
  });

  it('listens for valid conversation work wakeups and reconnects after listener failure', async () => {
    vi.useFakeTimers();
    const first = new FakeListenClient();
    const second = new FakeListenClient();
    const pool = {
      connect: vi.fn(async () =>
        pool.connect.mock.calls.length === 1 ? first : second,
      ),
      query: vi.fn(async () => undefined),
    };
    const notifier = new PostgresConversationWorkNotifier(pool as never);
    const listener = vi.fn();

    notifier.subscribe(listener);
    await vi.waitFor(() =>
      expect(first.query).toHaveBeenCalledWith(
        `LISTEN ${CONVERSATION_WORK_CHANNEL}`,
      ),
    );

    first.emit('notification', {
      channel: 'gantry_runtime_events',
      payload: JSON.stringify({
        app_id: 'app:default',
        conversation_id: 'wa:918097570021',
        thread_id: null,
        message_id: 'message:wa:918097570021:wa-existing-route',
      }),
    });
    expect(listener).not.toHaveBeenCalled();

    first.emit('notification', {
      channel: CONVERSATION_WORK_CHANNEL,
      payload: JSON.stringify({
        app_id: 'app:default',
        conversation_id: 'wa:918097570021',
      }),
    });
    expect(listener).not.toHaveBeenCalled();

    first.emit('notification', {
      channel: CONVERSATION_WORK_CHANNEL,
      payload: JSON.stringify({
        app_id: 'app:default',
        conversation_id: 'wa:918097570021',
        thread_id: null,
        message_id: 'message:wa:918097570021:wa-existing-route',
        owner_instance_id: 'server-b',
        lease_version: 42,
        lease_expires_at: '2026-06-17T00:00:00.000Z',
      }),
    });
    expect(listener).toHaveBeenCalledWith({
      appId: 'app:default',
      conversationId: 'wa:918097570021',
      threadId: null,
      messageId: 'message:wa:918097570021:wa-existing-route',
      ownerInstanceId: 'server-b',
      leaseVersion: 42,
      leaseExpiresAt: '2026-06-17T00:00:00.000Z',
    });
    listener.mockClear();

    first.emit('error', new Error('listener lost'));
    expect(first.release).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(second.query).toHaveBeenCalledWith(
        `LISTEN ${CONVERSATION_WORK_CHANNEL}`,
      ),
    );

    await notifier.close();
    vi.useRealTimers();
  });
});
