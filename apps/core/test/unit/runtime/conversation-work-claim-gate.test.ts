import { describe, expect, it, vi } from 'vitest';

import { createConversationWorkClaimGate } from '@core/runtime/conversation-work-claim-gate.js';
import type {
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
  ConversationOwnerLeaseRecord,
} from '@core/domain/ports/conversation-owner-lease-repository.js';

describe('createConversationWorkClaimGate', () => {
  const input: ClaimConversationOwnerLeaseInput = {
    appId: 'default',
    conversationId: 'wa:000000001',
    threadId: null,
    ownerInstanceId: 'runtime:1',
    leaseTtlMs: 45_000,
  };

  function lease(
    overrides: Partial<ConversationOwnerLeaseRecord> = {},
  ): ConversationOwnerLeaseRecord {
    return {
      appId: 'default',
      conversationId: 'wa:000000001',
      threadId: null,
      threadKey: '',
      ownerInstanceId: 'runtime:1',
      workerId: null,
      leaseVersion: 3,
      leaseExpiresAt: '2026-06-17T09:00:45.000Z',
      heartbeatAt: '2026-06-17T09:00:00.000Z',
      state: 'active',
      lastClaimReason: null,
      lastError: null,
      drainingStartedAt: null,
      createdAt: '2026-06-17T09:00:00.000Z',
      updatedAt: '2026-06-17T09:00:00.000Z',
      ...overrides,
    };
  }

  it('delegates new-work owner claims until closed', async () => {
    const result = {
      acquired: false,
      lease: lease({ ownerInstanceId: 'runtime:other' }),
    } satisfies ClaimConversationOwnerLeaseResult;
    const claimLease = vi.fn(async () => result);
    const gate = createConversationWorkClaimGate({ claimLease });

    await expect(gate.claimLease(input)).resolves.toBe(result);

    expect(claimLease).toHaveBeenCalledWith(input);
  });

  it('rejects new-work owner claims after shutdown begins', async () => {
    const claimLease = vi.fn(async () => {
      throw new Error('should not call repository');
    });
    const gate = createConversationWorkClaimGate({ claimLease });

    gate.close('runtime_shutdown');

    await expect(gate.claimLease(input)).rejects.toThrow(
      'Conversation work owner claims are closed: runtime_shutdown',
    );
    expect(claimLease).not.toHaveBeenCalled();
  });

  it('rejects a claim that completes after close while retaining it for cleanup', async () => {
    const acquiredLease = lease({
      conversationId: 'wa:000000001',
      leaseVersion: 8,
    });
    let resolveClaim:
      | ((result: ClaimConversationOwnerLeaseResult) => void)
      | undefined;
    const claimLease = vi.fn(
      () =>
        new Promise<ClaimConversationOwnerLeaseResult>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const releaseLease = vi.fn(async () => true);
    const gate = createConversationWorkClaimGate({ claimLease });

    const claim = gate.claimLease(input);
    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(1));

    gate.close('runtime_shutdown');
    resolveClaim?.({ acquired: true, lease: acquiredLease });

    await expect(claim).rejects.toThrow(
      'Conversation work owner claims are closed: runtime_shutdown',
    );
    await gate.releaseTrackedLeases({ releaseLease });

    expect(releaseLease).toHaveBeenCalledWith({
      appId: 'default',
      conversationId: 'wa:000000001',
      threadId: null,
      ownerInstanceId: 'runtime:1',
      leaseVersion: 8,
    });
  });

  it('waits for in-flight claims before releasing tracked leases', async () => {
    const acquiredLease = lease({
      conversationId: 'wa:000000001',
      leaseVersion: 9,
    });
    let resolveClaim:
      | ((result: ClaimConversationOwnerLeaseResult) => void)
      | undefined;
    const claimLease = vi.fn(
      () =>
        new Promise<ClaimConversationOwnerLeaseResult>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const releaseLease = vi.fn(async () => true);
    const gate = createConversationWorkClaimGate({ claimLease });

    const claim = gate.claimLease(input).catch((err: unknown) => err);
    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(1));
    gate.close('runtime_shutdown');

    let releaseSettled = false;
    const release = gate.releaseTrackedLeases({ releaseLease }).then(() => {
      releaseSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(releaseSettled).toBe(false);

    resolveClaim?.({ acquired: true, lease: acquiredLease });
    await expect(claim).resolves.toBeInstanceOf(Error);
    await release;

    expect(releaseLease).toHaveBeenCalledWith({
      appId: 'default',
      conversationId: 'wa:000000001',
      threadId: null,
      ownerInstanceId: 'runtime:1',
      leaseVersion: 9,
    });
  });

  it('bounds the wait for stuck in-flight claims during release cleanup', async () => {
    vi.useFakeTimers();
    let resolveClaim:
      | ((result: ClaimConversationOwnerLeaseResult) => void)
      | undefined;
    const claimLease = vi.fn(
      () =>
        new Promise<ClaimConversationOwnerLeaseResult>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const releaseLease = vi.fn(async () => true);
    const gate = createConversationWorkClaimGate({ claimLease });

    const claim = gate.claimLease(input).catch((err: unknown) => err);
    await vi.waitFor(() => expect(claimLease).toHaveBeenCalledTimes(1));
    gate.close('runtime_shutdown');

    let releaseSettled = false;
    const release = gate
      .releaseTrackedLeases({
        releaseLease,
        inFlightClaimWaitMs: 25,
      })
      .then(() => {
        releaseSettled = true;
      });
    try {
      await vi.advanceTimersByTimeAsync(25);
      expect(releaseSettled).toBe(true);
      expect(releaseLease).not.toHaveBeenCalled();
    } finally {
      resolveClaim?.({
        acquired: true,
        lease: lease({ leaseVersion: 10 }),
      });
      await claim;
      await release;
      vi.useRealTimers();
    }
  });

  it('releases only leases acquired through the gate', async () => {
    const first = lease({
      conversationId: 'wa:000000001',
      threadId: null,
      threadKey: '',
      leaseVersion: 3,
    });
    const refreshed = lease({
      conversationId: 'wa:000000001',
      threadId: null,
      threadKey: '',
      leaseVersion: 4,
    });
    const otherOwner = lease({
      conversationId: 'wa:000000002',
      ownerInstanceId: 'runtime:other',
      leaseVersion: 9,
    });
    const claimLease = vi
      .fn()
      .mockResolvedValueOnce({ acquired: true, lease: first })
      .mockResolvedValueOnce({ acquired: true, lease: refreshed })
      .mockResolvedValueOnce({ acquired: false, lease: otherOwner });
    const releaseLease = vi.fn(async () => true);
    const gate = createConversationWorkClaimGate({ claimLease });

    await gate.claimLease({
      ...input,
      conversationId: 'wa:000000001',
      threadId: null,
    });
    await gate.claimLease({
      ...input,
      conversationId: 'wa:000000001',
      threadId: null,
    });
    await gate.claimLease({
      ...input,
      conversationId: 'wa:000000002',
      threadId: null,
    });

    await gate.releaseTrackedLeases({ releaseLease });

    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(releaseLease).toHaveBeenCalledWith({
      appId: 'default',
      conversationId: 'wa:000000001',
      threadId: null,
      ownerInstanceId: 'runtime:1',
      leaseVersion: 4,
    });
  });

  it('attempts every tracked lease release before surfacing a release failure', async () => {
    const first = lease({
      conversationId: 'wa:000000001',
      leaseVersion: 3,
    });
    const second = lease({
      conversationId: 'wa:000000002',
      leaseVersion: 5,
    });
    const releaseError = new Error('release failed');
    const claimLease = vi
      .fn()
      .mockResolvedValueOnce({ acquired: true, lease: first })
      .mockResolvedValueOnce({ acquired: true, lease: second });
    const releaseLease = vi
      .fn()
      .mockRejectedValueOnce(releaseError)
      .mockResolvedValueOnce(true);
    const gate = createConversationWorkClaimGate({ claimLease });

    await gate.claimLease({
      ...input,
      conversationId: 'wa:000000001',
    });
    await gate.claimLease({
      ...input,
      conversationId: 'wa:000000002',
    });

    await expect(gate.releaseTrackedLeases({ releaseLease })).rejects.toBe(
      releaseError,
    );

    expect(releaseLease).toHaveBeenCalledTimes(2);
    expect(releaseLease).toHaveBeenNthCalledWith(1, {
      appId: 'default',
      conversationId: 'wa:000000001',
      threadId: null,
      ownerInstanceId: 'runtime:1',
      leaseVersion: 3,
    });
    expect(releaseLease).toHaveBeenNthCalledWith(2, {
      appId: 'default',
      conversationId: 'wa:000000002',
      threadId: null,
      ownerInstanceId: 'runtime:1',
      leaseVersion: 5,
    });
  });
});
