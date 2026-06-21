import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startIdleSessionSweepLoop } from '@core/runtime/idle-session-sweep.js';

describe('startIdleSessionSweepLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a sweep immediately, repeats on the interval, and stops on close', async () => {
    const runSweep = vi.fn(async () => undefined);
    const warn = vi.fn();

    const handle = startIdleSessionSweepLoop({
      runSweep,
      intervalMs: 1_000,
      logger: { warn },
    });

    await Promise.resolve();
    expect(runSweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runSweep).toHaveBeenCalledTimes(2);

    handle.close();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
