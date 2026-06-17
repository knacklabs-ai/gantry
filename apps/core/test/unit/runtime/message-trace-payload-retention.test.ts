import { afterEach, describe, expect, it, vi } from 'vitest';

import { startMessageTracePayloadRetention } from '@core/runtime/message-trace-payload-retention.js';

describe('startMessageTracePayloadRetention', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears old payloads immediately, repeats at the interval, and stops cleanly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'));
    const clearPayloadsOlderThan = vi.fn(async () => 2);
    const logger = { warn: vi.fn() };

    const handle = startMessageTracePayloadRetention({
      appId: 'default',
      retentionMs: 60_000,
      cleanupIntervalMs: 1_000,
      clearPayloadsOlderThan,
      logger,
    });

    expect(clearPayloadsOlderThan).toHaveBeenCalledTimes(1);
    expect(clearPayloadsOlderThan).toHaveBeenLastCalledWith({
      appId: 'default',
      before: '2026-06-17T11:59:00.000Z',
    });

    vi.setSystemTime(new Date('2026-06-17T12:00:01.000Z'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clearPayloadsOlderThan).toHaveBeenCalledTimes(2);
    expect(clearPayloadsOlderThan).toHaveBeenLastCalledWith({
      appId: 'default',
      before: '2026-06-17T11:59:02.000Z',
    });

    handle.close();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(clearPayloadsOlderThan).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs cleanup failures without throwing into runtime startup', async () => {
    vi.useFakeTimers();
    const clearPayloadsOlderThan = vi.fn(async () => {
      throw new Error('db unavailable');
    });
    const logger = { warn: vi.fn() };

    startMessageTracePayloadRetention({
      appId: 'default',
      retentionMs: 60_000,
      cleanupIntervalMs: 1_000,
      clearPayloadsOlderThan,
      logger,
    });
    await vi.runOnlyPendingTimersAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Message trace payload retention cleanup failed',
    );
  });
});
