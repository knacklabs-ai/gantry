import { describe, expect, it, vi } from 'vitest';

import {
  poolKeyOf,
  type BoundRun,
  type SharedBootRecipe,
  type WarmPoolCapable,
  type WarmWorkerHandle,
} from '@core/application/agent-execution/warm-pool-capable.js';
import { WarmPoolManager } from '@core/runtime/warm-pool-manager.js';

function makeRecipe(
  overrides: Partial<SharedBootRecipe> = {},
): SharedBootRecipe {
  const keyInput = {
    providerId: 'anthropic:claude-agent-sdk',
    appId: 'app-1',
    agentId: 'agent-1',
    persona: 'sales',
    model: 'opus',
    toolSurface: { gantryMcp: ['send_message'], native: ['Read'] },
    mcpSet: ['mcp:shopify-api'],
    thinking: { mode: 'enabled', effort: 'medium' },
    systemPromptVersion: 'prompt-v1',
  } as const;
  return {
    ...keyInput,
    key: poolKeyOf(keyInput),
    cwd: '/tmp/agent',
    compiledSystemPrompt: 'shared prompt',
    ...overrides,
  };
}

function makeCapability(now: () => number): {
  capability: WarmPoolCapable;
  recycled: WarmWorkerHandle[];
} {
  let nextWorkerId = 0;
  const recycled: WarmWorkerHandle[] = [];
  const capability: WarmPoolCapable = {
    id: 'anthropic:claude-agent-sdk',
    prepare: async () => {
      throw new Error('not used');
    },
    prewarm: vi.fn(async (recipe) => ({
      id: `worker-${++nextWorkerId}`,
      key: recipe.key,
      bornAt: now(),
      bound: false,
    })),
    bind: async (): Promise<BoundRun> => {
      throw new Error('not used');
    },
    recycle: vi.fn(async (handle) => {
      recycled.push(handle);
    }),
  };
  return { capability, recycled };
}

describe('WarmPoolManager', () => {
  it('prewarms N workers and reports idle size', async () => {
    let now = 1_000;
    const { capability } = makeCapability(() => now);
    const manager = new WarmPoolManager({ capability, clock: () => now });
    const recipe = makeRecipe();

    await manager.prewarm(recipe, 2);

    expect(manager.size(recipe.key)).toBe(2);
    expect(capability.prewarm).toHaveBeenCalledTimes(2);
  });

  it('treats repeated prewarm as ensure-size instead of overfilling', async () => {
    let now = 1_000;
    const { capability } = makeCapability(() => now);
    const manager = new WarmPoolManager({ capability, clock: () => now });
    const recipe = makeRecipe();

    await manager.prewarm(recipe, 2);
    await manager.prewarm(recipe, 2);

    expect(manager.size(recipe.key)).toBe(2);
    expect(capability.prewarm).toHaveBeenCalledTimes(2);
  });

  it('acquires one idle worker atomically and returns null when empty', async () => {
    let now = 1_000;
    const { capability } = makeCapability(() => now);
    const manager = new WarmPoolManager({ capability, clock: () => now });
    const recipe = makeRecipe();
    await manager.prewarm(recipe, 1);

    const first = manager.acquire(recipe.key);
    const second = manager.acquire(recipe.key);

    expect(first?.id).toBe('worker-1');
    expect(first?.bound).toBe(true);
    expect(second).toBeNull();
    expect(manager.size(recipe.key)).toBe(0);
  });

  it('recycles a released worker and replaces it without reusing the handle', async () => {
    let now = 1_000;
    const { capability, recycled } = makeCapability(() => now);
    const manager = new WarmPoolManager({ capability, clock: () => now });
    const recipe = makeRecipe();
    await manager.prewarm(recipe, 1);
    const acquired = manager.acquire(recipe.key);
    expect(acquired).not.toBeNull();

    now = 2_000;
    await manager.release(acquired!);
    const replacement = manager.acquire(recipe.key);

    expect(recycled.map((handle) => handle.id)).toEqual(['worker-1']);
    expect(replacement?.id).toBe('worker-2');
    expect(replacement?.id).not.toBe(acquired?.id);
  });

  it('evicts idle workers older than the ttl and replenishes the pool', async () => {
    let now = 1_000;
    const { capability, recycled } = makeCapability(() => now);
    const manager = new WarmPoolManager({ capability, clock: () => now });
    const recipe = makeRecipe();
    await manager.prewarm(recipe, 2);

    now = 2_001;
    await manager.evictIdle(1_000);

    expect(recycled.map((handle) => handle.id)).toEqual([
      'worker-1',
      'worker-2',
    ]);
    expect(manager.size(recipe.key)).toBe(2);
    expect(manager.acquire(recipe.key)?.id).toBe('worker-3');
    expect(manager.acquire(recipe.key)?.id).toBe('worker-4');
  });
});
