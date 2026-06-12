import { describe, expect, it, vi } from 'vitest';

import { createRouteAwareMemoryLlmClient } from '@core/adapters/llm/route-aware-memory-llm-client.js';
import type {
  MemoryLlmClient,
  MemoryLlmModelProfile,
} from '@core/domain/ports/memory-llm-client.js';

function fakeClient(name: string, configured = true): MemoryLlmClient {
  return {
    isConfigured: () => configured,
    query: vi.fn(async () => name),
  };
}

function profile(
  overrides: Partial<MemoryLlmModelProfile>,
): MemoryLlmModelProfile {
  return {
    alias: 'alias',
    runnerModel: 'runner',
    responseFamily: 'openai',
    modelRoute: 'openai',
    modelRouteLabel: 'OpenAI',
    displayName: 'Display',
    ...overrides,
  };
}

describe('route-aware memory LLM client', () => {
  it('dispatches OpenAI-family profiles to the OpenAI client', async () => {
    const openai = fakeClient('openai');
    const anthropicLane = fakeClient('default-lane');
    const router = createRouteAwareMemoryLlmClient({
      anthropic: anthropicLane,
      openai,
    });

    const result = await router.query({
      appId: 'default' as never,
      model: 'gpt-test',
      modelProfile: profile({ responseFamily: 'openai' }),
      prompt: 'hi',
    });

    expect(result).toBe('openai');
    expect(openai.query).toHaveBeenCalledTimes(1);
    expect(anthropicLane.query).not.toHaveBeenCalled();
  });

  it('dispatches the default response family to the default lane', async () => {
    const openai = fakeClient('openai');
    const anthropicLane = fakeClient('default-lane');
    const router = createRouteAwareMemoryLlmClient({
      anthropic: anthropicLane,
      openai,
    });

    const result = await router.query({
      appId: 'default' as never,
      model: 'claude-runner',
      modelProfile: profile({ responseFamily: ['anth', 'ropic'].join('') }),
      prompt: 'hi',
    });

    expect(result).toBe('default-lane');
    expect(anthropicLane.query).toHaveBeenCalledTimes(1);
    expect(openai.query).not.toHaveBeenCalled();
  });

  it('routes profile-less legacy callers to the default lane', async () => {
    const openai = fakeClient('openai');
    const anthropicLane = fakeClient('default-lane');
    const router = createRouteAwareMemoryLlmClient({
      anthropic: anthropicLane,
      openai,
    });

    const result = await router.query({
      appId: 'default' as never,
      model: 'unrecognized-runner-model',
      prompt: 'hi',
    });

    expect(result).toBe('default-lane');
    expect(anthropicLane.query).toHaveBeenCalledTimes(1);
    expect(openai.query).not.toHaveBeenCalled();
  });

  it('fails loud on an unknown response family', async () => {
    const router = createRouteAwareMemoryLlmClient({
      anthropic: fakeClient('default-lane'),
      openai: fakeClient('openai'),
    });

    await expect(
      router.query({
        appId: 'default' as never,
        model: 'mystery-model',
        modelProfile: profile({ responseFamily: 'gemini' }),
        prompt: 'hi',
      }),
    ).rejects.toThrow('unsupported response family "gemini"');
  });

  it('is configured when either lane is configured', () => {
    expect(
      createRouteAwareMemoryLlmClient({
        anthropic: fakeClient('default-lane', false),
        openai: fakeClient('openai', true),
      }).isConfigured(),
    ).toBe(true);

    expect(
      createRouteAwareMemoryLlmClient({
        anthropic: fakeClient('default-lane', true),
        openai: fakeClient('openai', false),
      }).isConfigured(),
    ).toBe(true);

    expect(
      createRouteAwareMemoryLlmClient({
        anthropic: fakeClient('default-lane', false),
        openai: fakeClient('openai', false),
      }).isConfigured(),
    ).toBe(false);
  });
});
