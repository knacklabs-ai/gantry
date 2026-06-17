import { afterEach, describe, expect, it } from 'vitest';

import type { NewMessage } from '@core/domain/types.js';
import {
  createPostgresIntegrationRuntime,
  hasPostgresIntegrationDatabase,
  type PostgresIntegrationRuntime,
} from '../harness/postgres-integration-runtime.js';

const maybeDescribe = hasPostgresIntegrationDatabase ? describe : describe.skip;

function inboundMessage(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: 'wa-msg-first',
    chat_jid: 'wa:918097570111',
    provider: 'interakt',
    sender: '918097570111',
    sender_name: 'Customer',
    content: 'hello',
    timestamp: '2026-05-22T11:46:00.000Z',
    is_from_me: false,
    is_bot_message: false,
    external_message_id: 'interakt-redelivery-1',
    ...overrides,
  };
}

maybeDescribe('Postgres canonical ops message store', () => {
  let runtimes: PostgresIntegrationRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.cleanup()));
    runtimes = [];
  });

  it('returns duplicate_existing_message when provider redelivery maps to an existing inbound message', async () => {
    const runtime = await createPostgresIntegrationRuntime({
      schemaPrefix: 'ops_msg_store',
    });
    runtimes.push(runtime);

    await expect(
      runtime.ops.storeMessage(inboundMessage()),
    ).resolves.toMatchObject({
      status: 'inserted_new_message',
      messageId: 'message:wa:918097570111:wa-msg-first',
    });

    await expect(
      runtime.ops.storeMessage(
        inboundMessage({
          id: 'wa-msg-redelivery',
          content: 'hello redelivered',
          timestamp: '2026-05-22T11:46:02.000Z',
        }),
      ),
    ).resolves.toMatchObject({
      status: 'duplicate_existing_message',
      messageId: 'message:wa:918097570111:wa-msg-first',
    });

    await expect(
      runtime.ops.getRecentMessages?.('wa:918097570111', 10),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'wa-msg-first',
        content: 'hello redelivered',
        external_message_id: 'interakt-redelivery-1',
      }),
    ]);
  });

  it('lists distinct inbound conversation jids newest first for durable recovery', async () => {
    const runtime = await createPostgresIntegrationRuntime({
      schemaPrefix: 'ops_msg_store_jids',
    });
    runtimes.push(runtime);

    await runtime.ops.storeMessage(
      inboundMessage({
        id: 'wa-msg-first-111',
        chat_jid: 'wa:918097570111',
        external_message_id: 'interakt-jid-111-first',
        timestamp: '2026-05-22T11:46:00.000Z',
      }),
    );
    await runtime.ops.storeMessage(
      inboundMessage({
        id: 'wa-msg-first-222',
        chat_jid: 'wa:918097570222',
        external_message_id: 'interakt-jid-222-first',
        timestamp: '2026-05-22T11:47:00.000Z',
      }),
    );
    await runtime.ops.storeMessage(
      inboundMessage({
        id: 'wa-msg-second-111',
        chat_jid: 'wa:918097570111',
        external_message_id: 'interakt-jid-111-second',
        timestamp: '2026-05-22T11:48:00.000Z',
      }),
    );
    await runtime.ops.storeMessage(
      inboundMessage({
        id: 'wa-msg-outbound-333',
        chat_jid: 'wa:918097570333',
        external_message_id: undefined,
        is_from_me: true,
        is_bot_message: true,
        timestamp: '2026-05-22T11:49:00.000Z',
      }),
    );

    await expect(
      runtime.ops.listInboundConversationJids?.({ limit: 10 }),
    ).resolves.toEqual(['wa:918097570111', 'wa:918097570222']);
  });
});
