import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresConversationOwnerLeaseRepository } from '@core/adapters/storage/postgres/repositories/conversation-owner-lease-repository.postgres.js';
import { createConversationWorkClaimGate } from '@core/runtime/conversation-work-claim-gate.js';

import {
  createPostgresIntegrationRuntime,
  hasPostgresIntegrationDatabase,
  type PostgresIntegrationRuntime,
} from '../harness/postgres-integration-runtime.js';

const maybeDescribe = hasPostgresIntegrationDatabase ? describe : describe.skip;

const appId = 'default';
const providerConnectionId = 'provider-connection:owner-lease';
const conversationId = 'conversation:owner-lease';
const rootConversationId = 'conversation:owner-lease:root-a';
const drainingConversationId = 'conversation:owner-lease:draining';
const releaseConversationId = 'conversation:owner-lease:release';
const gateReleaseConversationId = 'conversation:owner-lease:gate-release';
const gateDrainingConversationId = 'conversation:owner-lease:gate-draining';
const threadId = 'thread:owner-lease';
const BASE_TIME = new Date('2026-06-17T12:00:00.000Z');

function at(ms: number): Date {
  return new Date(BASE_TIME.getTime() + ms);
}

maybeDescribe('PostgresConversationOwnerLeaseRepository integration', () => {
  let runtime: PostgresIntegrationRuntime;
  let repository: PostgresConversationOwnerLeaseRepository;

  beforeAll(async () => {
    runtime = await createPostgresIntegrationRuntime({
      schemaPrefix: 'conversation_owner_lease',
    });
    repository = new PostgresConversationOwnerLeaseRepository(
      runtime.service.db,
    );

    await runtime.repositories.providerConnections.saveProviderConnection({
      id: providerConnectionId as never,
      appId: appId as never,
      providerId: 'slack' as never,
      externalInstallationRef: {
        kind: 'provider_connection',
        value: 'T-owner-lease',
      },
      label: 'Owner Lease Connection',
      status: 'active',
      config: {},
      runtimeSecretRefs: [],
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveConversation({
      id: conversationId as never,
      appId: appId as never,
      providerConnectionId: providerConnectionId as never,
      externalRef: { kind: 'conversation', value: 'C-owner-lease' },
      kind: 'channel',
      title: 'Owner Lease',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveConversation({
      id: rootConversationId as never,
      appId: appId as never,
      providerConnectionId: providerConnectionId as never,
      externalRef: { kind: 'conversation', value: 'C-owner-lease-root-a' },
      kind: 'channel',
      title: 'Owner Lease Root',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveConversation({
      id: drainingConversationId as never,
      appId: appId as never,
      providerConnectionId: providerConnectionId as never,
      externalRef: { kind: 'conversation', value: 'C-owner-lease-draining' },
      kind: 'channel',
      title: 'Owner Lease Draining',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveConversation({
      id: releaseConversationId as never,
      appId: appId as never,
      providerConnectionId: providerConnectionId as never,
      externalRef: { kind: 'conversation', value: 'C-owner-lease-release' },
      kind: 'channel',
      title: 'Owner Lease Release',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveConversation({
      id: gateReleaseConversationId as never,
      appId: appId as never,
      providerConnectionId: providerConnectionId as never,
      externalRef: {
        kind: 'conversation',
        value: 'C-owner-lease-gate-release',
      },
      kind: 'channel',
      title: 'Owner Lease Gate Release',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveConversation({
      id: gateDrainingConversationId as never,
      appId: appId as never,
      providerConnectionId: providerConnectionId as never,
      externalRef: {
        kind: 'conversation',
        value: 'C-owner-lease-gate-draining',
      },
      kind: 'channel',
      title: 'Owner Lease Gate Draining',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
    await runtime.repositories.conversations.saveThread({
      id: threadId as never,
      appId: appId as never,
      conversationId: conversationId as never,
      externalRef: { kind: 'conversation_thread', value: 'thread-owner-lease' },
      title: 'owner-thread',
      status: 'active',
      createdAt: BASE_TIME.toISOString(),
      updatedAt: BASE_TIME.toISOString(),
    });
  }, 60_000);

  afterAll(async () => {
    await runtime?.cleanup();
  });

  it('allows only one concurrent owner for the same conversation thread key', async () => {
    const claims = await Promise.all(
      ['server-a', 'server-b', 'server-c'].map((ownerInstanceId) =>
        repository.claimLease({
          appId,
          conversationId,
          threadId: null,
          ownerInstanceId,
          leaseTtlMs: 30_000,
          now: at(0),
          reason: 'inbound',
        }),
      ),
    );

    const acquired = claims.filter((claim) => claim.acquired);
    expect(acquired).toHaveLength(1);
    expect(
      new Set(claims.map((claim) => claim.lease.ownerInstanceId)).size,
    ).toBe(1);
    expect(claims[0].lease.threadKey).toBe('');
    expect(claims[0].lease.leaseVersion).toBe(1);
  });

  it('translates runtime conversation and thread ids to canonical foreign keys', async () => {
    const rawConversationId = 'wa:918097570099';
    const rawThreadId = 'thread-raw';
    await runtime.ops.storeMessage({
      id: 'owner-lease-raw-message',
      chat_jid: rawConversationId,
      provider: 'interakt',
      sender: '918097570099',
      sender_name: 'Raw Owner Lease',
      content: 'hello',
      timestamp: at(0).toISOString(),
      is_from_me: false,
      is_bot_message: false,
      thread_id: rawThreadId,
    });

    const claim = await repository.claimLease({
      appId,
      conversationId: rawConversationId,
      threadId: rawThreadId,
      ownerInstanceId: 'server-raw-runtime-id',
      leaseTtlMs: 30_000,
      now: at(0),
      reason: 'raw-runtime-id',
    });

    expect(claim.acquired).toBe(true);
    expect(claim.lease.conversationId).toBe(rawConversationId);
    expect(claim.lease.threadId).toBe(rawThreadId);
    expect(claim.lease.threadKey).toBe(rawThreadId);

    const rows = await runtime.service.pool.query<{
      conversation_id: string;
      thread_id: string | null;
    }>(
      `SELECT conversation_id, thread_id
       FROM ${runtime.schemaName}.conversation_owner_leases
       WHERE owner_instance_id = $1`,
      ['server-raw-runtime-id'],
    );
    expect(rows.rows).toEqual([
      {
        conversation_id: `conversation:${rawConversationId}`,
        thread_id: `thread:${rawConversationId}:${rawThreadId}`,
      },
    ]);
  });

  it('takes over an expired lease and rejects stale heartbeats', async () => {
    const first = await repository.claimLease({
      appId,
      conversationId,
      threadId,
      ownerInstanceId: 'server-a',
      workerId: 'worker-a',
      leaseTtlMs: 1_000,
      now: at(0),
      reason: 'first-message',
    });
    const takeover = await repository.claimLease({
      appId,
      conversationId,
      threadId,
      ownerInstanceId: 'server-b',
      workerId: 'worker-b',
      leaseTtlMs: 30_000,
      now: at(2_000),
      reason: 'expired-owner',
    });

    expect(first.acquired).toBe(true);
    expect(takeover.acquired).toBe(true);
    expect(takeover.lease.ownerInstanceId).toBe('server-b');
    expect(takeover.lease.leaseVersion).toBe(first.lease.leaseVersion + 1);

    await expect(
      repository.heartbeatLease({
        appId,
        conversationId,
        threadId,
        ownerInstanceId: 'server-a',
        leaseVersion: first.lease.leaseVersion,
        leaseTtlMs: 30_000,
        now: at(2_500),
      }),
    ).resolves.toBeNull();

    const heartbeat = await repository.heartbeatLease({
      appId,
      conversationId,
      threadId,
      ownerInstanceId: 'server-b',
      leaseVersion: takeover.lease.leaseVersion,
      leaseTtlMs: 30_000,
      now: at(3_000),
    });

    expect(heartbeat?.leaseVersion).toBe(takeover.lease.leaseVersion);
    expect(heartbeat?.heartbeatAt).toBe(at(3_000).toISOString());
    await expect(
      repository.verifyLeaseVersion({
        appId,
        conversationId,
        threadId,
        ownerInstanceId: 'server-b',
        leaseVersion: takeover.lease.leaseVersion,
        now: at(3_000),
      }),
    ).resolves.toBe(true);
  });

  it('uses an empty non-null thread key for root conversation leases', async () => {
    const first = await repository.claimLease({
      appId,
      conversationId: rootConversationId,
      threadId: null,
      ownerInstanceId: 'server-root-a',
      leaseTtlMs: 30_000,
      now: at(0),
    });
    const second = await repository.claimLease({
      appId,
      conversationId: rootConversationId,
      threadId: null,
      ownerInstanceId: 'server-root-b',
      leaseTtlMs: 30_000,
      now: at(100),
    });

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.lease.ownerInstanceId).toBe('server-root-a');
    expect(second.lease.threadKey).toBe('');
  });

  it('releases an exact active lease token so another instance can claim the key', async () => {
    const initial = await repository.claimLease({
      appId,
      conversationId: releaseConversationId,
      threadId: null,
      ownerInstanceId: 'server-release-a',
      leaseTtlMs: 30_000,
      now: at(0),
      reason: 'release-start',
    });

    await expect(
      repository.releaseLease({
        appId,
        conversationId: releaseConversationId,
        threadId: null,
        ownerInstanceId: 'server-release-a',
        leaseVersion: initial.lease.leaseVersion + 1,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.verifyLeaseVersion({
        appId,
        conversationId: releaseConversationId,
        threadId: null,
        ownerInstanceId: 'server-release-a',
        leaseVersion: initial.lease.leaseVersion,
        now: at(100),
      }),
    ).resolves.toBe(true);

    await expect(
      repository.releaseLease({
        appId,
        conversationId: releaseConversationId,
        threadId: null,
        ownerInstanceId: 'server-release-a',
        leaseVersion: initial.lease.leaseVersion,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.verifyLeaseVersion({
        appId,
        conversationId: releaseConversationId,
        threadId: null,
        ownerInstanceId: 'server-release-a',
        leaseVersion: initial.lease.leaseVersion,
        now: at(200),
      }),
    ).resolves.toBe(false);

    const next = await repository.claimLease({
      appId,
      conversationId: releaseConversationId,
      threadId: null,
      ownerInstanceId: 'server-release-b',
      leaseTtlMs: 30_000,
      now: at(300),
      reason: 'release-reclaim',
    });

    expect(initial.acquired).toBe(true);
    expect(next.acquired).toBe(true);
    expect(next.lease.ownerInstanceId).toBe('server-release-b');
    expect(next.lease.leaseVersion).toBe(1);
  });

  it('marks an instance draining and allows another instance to take over', async () => {
    const initial = await repository.claimLease({
      appId,
      conversationId: drainingConversationId,
      threadId: null,
      ownerInstanceId: 'server-draining',
      leaseTtlMs: 30_000,
      now: at(0),
    });

    const drained = await repository.markDraining({
      ownerInstanceId: 'server-draining',
      now: at(100),
    });
    const localClaim = await repository.claimLease({
      appId,
      conversationId: drainingConversationId,
      threadId: null,
      ownerInstanceId: 'server-draining',
      leaseTtlMs: 30_000,
      now: at(200),
    });
    const takeover = await repository.claimLease({
      appId,
      conversationId: drainingConversationId,
      threadId: null,
      ownerInstanceId: 'server-fresh',
      leaseTtlMs: 30_000,
      now: at(300),
      reason: 'draining-takeover',
    });

    expect(initial.acquired).toBe(true);
    expect(drained).toBe(1);
    expect(localClaim.acquired).toBe(false);
    expect(localClaim.lease.state).toBe('draining');
    expect(takeover.acquired).toBe(true);
    expect(takeover.lease.ownerInstanceId).toBe('server-fresh');
    expect(takeover.lease.leaseVersion).toBe(initial.lease.leaseVersion + 1);
  });

  it('claim gate releases cleanly drained leases before remaining instance rows are marked draining', async () => {
    const gate = createConversationWorkClaimGate({
      claimLease: (input) => repository.claimLease(input),
    });
    const tracked = await gate.claimLease({
      appId,
      conversationId: gateReleaseConversationId,
      threadId: null,
      ownerInstanceId: 'server-shutdown',
      leaseTtlMs: 30_000,
      now: at(0),
      reason: 'claim-gate-tracked',
    });
    const unmanaged = await repository.claimLease({
      appId,
      conversationId: gateDrainingConversationId,
      threadId: null,
      ownerInstanceId: 'server-shutdown',
      leaseTtlMs: 30_000,
      now: at(0),
      reason: 'unmanaged-local-work',
    });

    gate.close('runtime_shutdown');
    await gate.releaseTrackedLeases({
      releaseLease: (input) => repository.releaseLease(input),
      inFlightClaimWaitMs: 10,
    });
    const drained = await repository.markDraining({
      ownerInstanceId: 'server-shutdown',
      now: at(100),
      reason: 'runtime_shutdown',
    });

    expect(tracked.acquired).toBe(true);
    expect(unmanaged.acquired).toBe(true);
    expect(drained).toBe(1);
    await expect(
      repository.verifyLeaseVersion({
        appId,
        conversationId: gateReleaseConversationId,
        threadId: null,
        ownerInstanceId: 'server-shutdown',
        leaseVersion: tracked.lease.leaseVersion,
        now: at(200),
      }),
    ).resolves.toBe(false);
    const localAfterDrain = await repository.claimLease({
      appId,
      conversationId: gateDrainingConversationId,
      threadId: null,
      ownerInstanceId: 'server-shutdown',
      leaseTtlMs: 30_000,
      now: at(200),
    });
    const takeover = await repository.claimLease({
      appId,
      conversationId: gateDrainingConversationId,
      threadId: null,
      ownerInstanceId: 'server-after-shutdown',
      leaseTtlMs: 30_000,
      now: at(300),
      reason: 'post-shutdown-takeover',
    });

    expect(localAfterDrain.acquired).toBe(false);
    expect(localAfterDrain.lease.state).toBe('draining');
    expect(takeover.acquired).toBe(true);
    expect(takeover.lease.ownerInstanceId).toBe('server-after-shutdown');
    expect(takeover.lease.leaseVersion).toBe(unmanaged.lease.leaseVersion + 1);
  });
});
