// Adaptive-drain + bounded-concurrency helpers for the idle memory sweep, kept free
// of DB/runtime coupling so the loop logic is unit-testable.

/**
 * Run `fn` over `items` with at most `limit` invocations in flight at once. A fixed
 * pool of workers each pull the next item until the list is exhausted, so peak
 * concurrency is min(limit, items.length) — never sequential, never unbounded.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const workers = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * Adaptive drain: fetch a batch, process it with bounded concurrency, and keep
 * going as long as batches come back FULL (== batchSize) — i.e. there is more
 * backlog. Stop on the first partial/empty batch (caught up), so the caller's poll
 * cadence handles the steady state instead of re-querying in a tight loop.
 * Returns the total number of items processed across all batches.
 */
export async function drainBatches<T>(input: {
  fetchBatch: () => Promise<T[]>;
  processItem: (item: T) => Promise<void>;
  batchSize: number;
  concurrency: number;
}): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await input.fetchBatch();
    if (batch.length === 0) break;
    await mapWithConcurrency(batch, input.concurrency, input.processItem);
    total += batch.length;
    if (batch.length < input.batchSize) break;
  }
  return total;
}
