import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configurePendingInteractionDurability,
  isActiveRunLeaseForInteraction,
  recordRunScopedTransientGrant,
} from '@core/application/interactions/pending-interaction-durability.js';

describe('pending interaction durability', () => {
  afterEach(() => {
    configurePendingInteractionDurability(null);
  });

  it('does not rebind a transient grant to a recovered lease', async () => {
    const repository = {
      getActiveRunLease: vi.fn(async () => ({
        runId: 'run-1',
        jobId: 'job-1',
        workerInstanceId: 'worker-2',
        leaseToken: 'new-token',
        fencingVersion: 2,
        status: 'active',
        claimedAt: '2026-06-10T00:01:00.000Z',
        expiresAt: '2026-06-10T00:06:00.000Z',
        heartbeatAt: '2026-06-10T00:01:00.000Z',
      })),
      createTransientGrant: vi.fn(async () => true),
    };
    configurePendingInteractionDurability({
      repository: repository as never,
    });

    await recordRunScopedTransientGrant({
      runId: 'run-1',
      runLeaseToken: 'old-token',
      runLeaseFencingVersion: 1,
      grant: { toolName: 'Bash', mode: 'allow_once' },
    });

    expect(repository.createTransientGrant).not.toHaveBeenCalled();
  });

  it('rejects interaction lease checks for a recovered lease', async () => {
    const repository = {
      getActiveRunLease: vi.fn(async () => ({
        runId: 'run-1',
        jobId: 'job-1',
        workerInstanceId: 'worker-2',
        leaseToken: 'new-token',
        fencingVersion: 2,
        status: 'active',
        claimedAt: '2026-06-10T00:01:00.000Z',
        expiresAt: '2026-06-10T00:06:00.000Z',
        heartbeatAt: '2026-06-10T00:01:00.000Z',
      })),
    };
    configurePendingInteractionDurability({
      repository: repository as never,
    });

    await expect(
      isActiveRunLeaseForInteraction({
        runId: 'run-1',
        runLeaseToken: 'old-token',
        runLeaseFencingVersion: 1,
      }),
    ).resolves.toBe(false);
  });

  it('does not create transient grants without the requesting lease identity', async () => {
    const repository = {
      getActiveRunLease: vi.fn(async () => ({
        runId: 'run-1',
        jobId: 'job-1',
        workerInstanceId: 'worker-1',
        leaseToken: 'lease-token',
        fencingVersion: 1,
        status: 'active',
        claimedAt: '2026-06-10T00:00:00.000Z',
        expiresAt: '2026-06-10T00:05:00.000Z',
        heartbeatAt: '2026-06-10T00:00:00.000Z',
      })),
      createTransientGrant: vi.fn(async () => true),
    };
    configurePendingInteractionDurability({
      repository: repository as never,
    });

    await recordRunScopedTransientGrant({
      runId: 'run-1',
      grant: { toolName: 'Bash', mode: 'allow_once' },
    });

    expect(repository.createTransientGrant).not.toHaveBeenCalled();
  });

  it('binds a transient grant to the requesting active lease', async () => {
    const repository = {
      getActiveRunLease: vi.fn(async () => ({
        runId: 'run-1',
        jobId: 'job-1',
        workerInstanceId: 'worker-1',
        leaseToken: 'lease-token',
        fencingVersion: 1,
        status: 'active',
        claimedAt: '2026-06-10T00:00:00.000Z',
        expiresAt: '2026-06-10T00:05:00.000Z',
        heartbeatAt: '2026-06-10T00:00:00.000Z',
      })),
      createTransientGrant: vi.fn(async () => true),
    };
    configurePendingInteractionDurability({
      repository: repository as never,
    });

    await recordRunScopedTransientGrant({
      appId: 'default',
      runId: 'run-1',
      runLeaseToken: 'lease-token',
      runLeaseFencingVersion: 1,
      grant: { toolName: 'Bash', mode: 'allow_once' },
    });

    expect(repository.createTransientGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'default',
        runId: 'run-1',
        leaseToken: 'lease-token',
        grant: { toolName: 'Bash', mode: 'allow_once' },
      }),
    );
  });
});
