import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireRunSlot,
  configureRunSlotBackend,
  resetSchedulerRunSlots,
} from '@core/jobs/concurrency.js';
import type { RunSlotRepository } from '@core/domain/ports/worker-coordination.js';

function makeFakeRunSlotRepository(): RunSlotRepository & {
  held: Map<string, Set<string>>;
} {
  const held = new Map<string, Set<string>>();
  return {
    held,
    async acquireRunSlot(input) {
      const holders = held.get(input.slotKey) ?? new Set<string>();
      if (holders.size >= input.capacity && !holders.has(input.holderId)) {
        return false;
      }
      holders.add(input.holderId);
      held.set(input.slotKey, holders);
      return true;
    },
    async renewRunSlot(input) {
      return held.get(input.slotKey)?.has(input.holderId) === true;
    },
    async releaseRunSlot(input) {
      held.get(input.slotKey)?.delete(input.holderId);
    },
  };
}

describe('scheduler run slots', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetSchedulerRunSlots();
  });

  it('throws when no cluster slot backend is configured', async () => {
    await expect(acquireRunSlot('agent-a')).rejects.toThrow(
      /Run slot backend is not configured/,
    );
  });

  it('serializes concurrent runs for the same group scope by default', async () => {
    vi.useFakeTimers();
    const repository = makeFakeRunSlotRepository();
    configureRunSlotBackend({ repository, workerInstanceId: 'worker-test' });
    const releaseFirst = await acquireRunSlot('agent-a');
    let secondAcquired = false;
    const second = acquireRunSlot('agent-a').then((release) => {
      secondAcquired = true;
      return release;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(secondAcquired).toBe(false);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(200);
    const releaseSecond = await second;
    expect(secondAcquired).toBe(true);

    releaseSecond();
  });

  it('allows different group scopes to run concurrently', async () => {
    vi.useFakeTimers();
    const repository = makeFakeRunSlotRepository();
    configureRunSlotBackend({ repository, workerInstanceId: 'worker-test' });
    const releaseFirst = await acquireRunSlot('agent-a');
    let secondAcquired = false;
    const second = acquireRunSlot('agent-b').then((release) => {
      secondAcquired = true;
      return release;
    });

    await vi.advanceTimersByTimeAsync(0);
    const releaseSecond = await second;
    expect(secondAcquired).toBe(true);

    releaseSecond();
    releaseFirst();
  });
});
