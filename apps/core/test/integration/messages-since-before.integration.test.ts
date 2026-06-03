import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppId } from '@core/domain/app/app.js';
import type { AgentId } from '@core/domain/agent/agent.js';
import type {
  ProviderConnectionId,
  ProviderId,
} from '@core/domain/provider/provider.js';
import type { ConversationId } from '@core/domain/conversation/conversation.js';
import type { MessageId } from '@core/domain/messages/messages.js';
import type { MessageRepository } from '@core/domain/ports/repositories.js';
import {
  DEFAULT_AGENT_ID,
  DEFAULT_APP_ID,
} from '@core/adapters/storage/postgres/seeds.js';

import {
  createPostgresIntegrationRuntime,
  hasPostgresIntegrationDatabase,
  type PostgresIntegrationRuntime,
} from '../harness/postgres-integration-runtime.js';

const maybeDescribe = hasPostgresIntegrationDatabase ? describe : describe.skip;

const appId = DEFAULT_APP_ID as AppId;
const agentId = DEFAULT_AGENT_ID as AgentId;
const providerId = 'slack' as ProviderId;
const providerConnectionId =
  'channel-providerConnection:msb:slack' as ProviderConnectionId;
const conversationId = 'conversation:msb:slack:C-MSB' as ConversationId;
const now = '2026-06-04T00:00:00.000Z';

// Five controlled timestamps: t1 < t2 < t3 = t3 < t4 < t5
// (two messages share t3, tie-broken by id: m3a < m3b)
const t1 = '2026-06-04T10:01:00.000Z';
const t2 = '2026-06-04T10:02:00.000Z';
const t3 = '2026-06-04T10:03:00.000Z'; // shared by m3a AND m3b
const t4 = '2026-06-04T10:04:00.000Z';
const t5 = '2026-06-04T10:05:00.000Z';

maybeDescribe('getMessagesSince + getMessagesBefore cursor reads', () => {
  let runtime: PostgresIntegrationRuntime;
  let repo: MessageRepository;

  beforeAll(async () => {
    runtime = await createPostgresIntegrationRuntime({
      schemaPrefix: 'msb',
    });
    repo = runtime.repositories.messages;

    // Set up FK prerequisites: provider connection + conversation
    await runtime.repositories.providerConnections.saveProviderConnection({
      id: providerConnectionId,
      appId,
      providerId,
      externalInstallationRef: { kind: 'provider_connection', value: 'T-MSB' },
      label: 'MSB Slack',
      status: 'active',
      config: { workspace: 'msb' },
      runtimeSecretRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    await runtime.repositories.conversations.saveConversation({
      id: conversationId,
      appId,
      providerConnectionId,
      externalRef: { kind: 'conversation', value: 'C-MSB' },
      kind: 'channel',
      title: 'msb-test',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // Insert m1..m5 with controlled created_at.
    // m3a and m3b share t3; m3a < m3b lexicographically (ensured by the id strings below).
    const messages: Array<{
      id: string;
      createdAt: string;
    }> = [
      { id: 'm1-msb', createdAt: t1 },
      { id: 'm2-msb', createdAt: t2 },
      { id: 'm3a-msb', createdAt: t3 },
      { id: 'm3b-msb', createdAt: t3 },
      { id: 'm4-msb', createdAt: t4 },
      { id: 'm5-msb', createdAt: t5 },
    ];

    for (const msg of messages) {
      await repo.saveMessage({
        id: msg.id as MessageId,
        appId,
        conversationId,
        direction: 'inbound',
        trust: 'trusted',
        createdAt: msg.createdAt,
        parts: [],
        attachments: [],
      });
    }
  }, 60_000);

  afterAll(async () => {
    await runtime.cleanup();
  });

  it('getMessagesSince returns only messages after the cursor (tie-broken by id)', async () => {
    const out = await repo.getMessagesSince({
      conversationId,
      since: t3,
      sinceId: 'm3a-msb',
      limit: 80,
    });
    expect(out.map((m) => m.id)).toEqual(['m3b-msb', 'm4-msb', 'm5-msb']);
  });

  it('getMessagesBefore returns the last N at/before the cursor, oldest→newest', async () => {
    const out = await repo.getMessagesBefore({
      conversationId,
      before: t4,
      beforeId: 'm4-msb',
      limit: 2,
    });
    expect(out.map((m) => m.id)).toEqual(['m3b-msb', 'm4-msb']);
  });

  it('getMessagesSince with no limit defaults to 80 and returns oldest-first', async () => {
    const out = await repo.getMessagesSince({
      conversationId,
      since: t1,
      sinceId: 'm1-msb',
      // no limit
    });
    // Should return m2, m3a, m3b, m4, m5 in order
    expect(out.map((m) => m.id)).toEqual([
      'm2-msb',
      'm3a-msb',
      'm3b-msb',
      'm4-msb',
      'm5-msb',
    ]);
  });

  it('getMessagesBefore with limit 1 returns only the cursor message', async () => {
    const out = await repo.getMessagesBefore({
      conversationId,
      before: t3,
      beforeId: 'm3a-msb',
      limit: 1,
    });
    expect(out.map((m) => m.id)).toEqual(['m3a-msb']);
  });

  it('getMessagesSince returns empty array when nothing is after the cursor', async () => {
    const out = await repo.getMessagesSince({
      conversationId,
      since: t5,
      sinceId: 'm5-msb',
      limit: 80,
    });
    expect(out).toEqual([]);
  });
});
