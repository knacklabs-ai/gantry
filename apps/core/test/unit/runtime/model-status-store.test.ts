import { describe, expect, it } from 'vitest';

import {
  getRuntimeModelStatus,
  updateRuntimeModelStatus,
} from '@core/runtime/model-status-store.js';

describe('runtime model status store', () => {
  it('deduplicates cumulative usage with the same usage key', () => {
    const usage = {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic' as const,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      totalBillableInputTokens: 9,
      cacheProvider: 'anthropic' as const,
      cacheStatus: 'hit' as const,
      estimatedCostUsd: 0.01,
      at: '2026-05-01T00:00:00.000Z',
    };

    updateRuntimeModelStatus({
      scopeKey: 'dedupe',
      selectionSource: 'chat default',
      modelAlias: 'sonnet',
      usage,
      usageKey: 'turn-1',
    });
    updateRuntimeModelStatus({
      scopeKey: 'dedupe',
      selectionSource: 'chat default',
      modelAlias: 'sonnet',
      usage,
      usageKey: 'turn-1',
    });

    expect(
      getRuntimeModelStatus({ scopeKey: 'dedupe' })?.cumulativeUsage,
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      totalBillableInputTokens: 9,
      estimatedCostUsd: 0.01,
    });
  });

  it('keeps thread model statuses separate', () => {
    updateRuntimeModelStatus({
      scopeKey: 'threaded',
      threadId: 'one',
      selectionSource: 'chat default',
      modelAlias: 'sonnet',
    });
    updateRuntimeModelStatus({
      scopeKey: 'threaded',
      threadId: 'two',
      selectionSource: 'chat default',
      modelAlias: 'haiku',
    });

    expect(
      getRuntimeModelStatus({ scopeKey: 'threaded', threadId: 'one' })
        ?.modelAlias,
    ).toBe('sonnet');
    expect(
      getRuntimeModelStatus({ scopeKey: 'threaded', threadId: 'two' })
        ?.modelAlias,
    ).toBe('haiku');
  });

  it('evicts oldest snapshots when the store is bounded', () => {
    for (let i = 0; i < 501; i += 1) {
      updateRuntimeModelStatus({
        scopeKey: `scope-${i}`,
        selectionSource: 'chat default',
        modelAlias: 'sonnet',
      });
    }

    expect(getRuntimeModelStatus({ scopeKey: 'scope-0' })).toBeUndefined();
    expect(getRuntimeModelStatus({ scopeKey: 'scope-500' })).toBeDefined();
  });

  it('bounds dedupe keys for a long-lived status scope', () => {
    const usage = {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic' as const,
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalBillableInputTokens: 1,
      cacheProvider: 'anthropic' as const,
      cacheStatus: 'miss' as const,
      at: '2026-05-01T00:00:00.000Z',
    };

    for (let i = 0; i < 205; i += 1) {
      updateRuntimeModelStatus({
        scopeKey: 'long-lived',
        selectionSource: 'chat default',
        modelAlias: 'sonnet',
        usage,
        usageKey: `turn-${i}`,
      });
    }
    updateRuntimeModelStatus({
      scopeKey: 'long-lived',
      selectionSource: 'chat default',
      modelAlias: 'sonnet',
      usage,
      usageKey: 'turn-0',
    });
    updateRuntimeModelStatus({
      scopeKey: 'long-lived',
      selectionSource: 'chat default',
      modelAlias: 'sonnet',
      usage,
      usageKey: 'turn-204',
    });

    expect(
      getRuntimeModelStatus({ scopeKey: 'long-lived' })?.cumulativeUsage
        .inputTokens,
    ).toBe(206);
  });
});
