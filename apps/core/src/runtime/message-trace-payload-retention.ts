export interface MessageTracePayloadRetentionHandle {
  close: () => void;
}

export interface MessageTracePayloadRetentionLogger {
  warn: (payload: Record<string, unknown>, message: string) => void;
}

export interface MessageTracePayloadRetentionOptions {
  appId: string;
  retentionMs: number;
  cleanupIntervalMs: number;
  clearPayloadsOlderThan: (input: {
    appId: string;
    before: string;
  }) => Promise<number>;
  logger: MessageTracePayloadRetentionLogger;
  now?: () => Date;
}

export function startMessageTracePayloadRetention(
  options: MessageTracePayloadRetentionOptions,
): MessageTracePayloadRetentionHandle {
  let closed = false;
  let inFlight = false;
  const now = options.now ?? (() => new Date());

  const cleanup = async (): Promise<void> => {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const before = new Date(
        now().getTime() - options.retentionMs,
      ).toISOString();
      await options.clearPayloadsOlderThan({
        appId: options.appId,
        before,
      });
    } catch (err) {
      options.logger.warn(
        { err },
        'Message trace payload retention cleanup failed',
      );
    } finally {
      inFlight = false;
    }
  };

  void cleanup();
  const interval = setInterval(() => {
    void cleanup();
  }, options.cleanupIntervalMs);
  interval.unref?.();

  return {
    close: () => {
      closed = true;
      clearInterval(interval);
    },
  };
}
