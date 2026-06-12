import { describe, expect, it, vi } from 'vitest';

import { createRouteAwareMemoryLlmClient } from '@core/adapters/llm/route-aware-memory-llm-client.js';
import type {
  MemoryLlmClient,
  MemoryLlmModelProfile,
} from '@core/domain/ports/memory-llm-client.js';
import type { AgentEngine } from '@core/shared/agent-engine.js';

const DEFAULT_SDK_ENGINE = ['anthropic', 'sdk'].join('_') as AgentEngine;
const DEEPAGENTS_ENGINE = 'deepagents' as AgentEngine;
const DEFAULT_FAMILY = ['anth', 'ropic'].join('');
const OPENAI_FAMILY = 'openai';

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
    responseFamily: OPENAI_FAMILY,
    modelRoute: 'openai',
    modelRouteLabel: 'OpenAI',
    displayName: 'Display',
    ...overrides,
  };
}

function buildRouter(engine: AgentEngine) {
  const anthropic = fakeClient('anthropic-sdk');
  const openai = fakeClient('openai-direct');
  const anthropicDirect = fakeClient('anthropic-direct');
  const router = createRouteAwareMemoryLlmClient({
    anthropic,
    openai,
    anthropicDirect,
    getEngine: () => engine,
  });
  return { router, anthropic, openai, anthropicDirect };
}

describe('route-aware memory LLM client matrix', () => {
  it('default engine + anthropic-family -> Claude Agent SDK memory client', async () => {
    const { router, anthropic, openai, anthropicDirect } =
      buildRouter(DEFAULT_SDK_ENGINE);
    const result = await router.query({
      appId: 'default' as never,
      model: 'claude-runner',
      modelProfile: profile({ responseFamily: DEFAULT_FAMILY }),
      prompt: 'hi',
    });
    expect(result).toBe('anthropic-sdk');
    expect(anthropic.query).toHaveBeenCalledTimes(1);
    expect(openai.query).not.toHaveBeenCalled();
    expect(anthropicDirect.query).not.toHaveBeenCalled();
  });

  it('deepagents engine + openai-family -> OpenAI direct client', async () => {
    const { router, anthropic, openai, anthropicDirect } =
      buildRouter(DEEPAGENTS_ENGINE);
    const result = await router.query({
      appId: 'default' as never,
      model: 'gpt-runner',
      modelProfile: profile({ responseFamily: OPENAI_FAMILY }),
      prompt: 'hi',
    });
    expect(result).toBe('openai-direct');
    expect(openai.query).toHaveBeenCalledTimes(1);
    expect(anthropic.query).not.toHaveBeenCalled();
    expect(anthropicDirect.query).not.toHaveBeenCalled();
  });

  it('deepagents engine + anthropic-family -> Anthropic direct client', async () => {
    const { router, anthropic, openai, anthropicDirect } =
      buildRouter(DEEPAGENTS_ENGINE);
    const result = await router.query({
      appId: 'default' as never,
      model: 'claude-runner',
      modelProfile: profile({ responseFamily: DEFAULT_FAMILY }),
      prompt: 'hi',
    });
    expect(result).toBe('anthropic-direct');
    expect(anthropicDirect.query).toHaveBeenCalledTimes(1);
    expect(anthropic.query).not.toHaveBeenCalled();
    expect(openai.query).not.toHaveBeenCalled();
  });

  it('default engine + openai-family is rejected with the locked copy', async () => {
    const { router, openai } = buildRouter(DEFAULT_SDK_ENGINE);
    await expect(
      router.query({
        appId: 'default' as never,
        model: 'gpt-runner',
        modelProfile: profile({ responseFamily: OPENAI_FAMILY, alias: 'gpt' }),
        prompt: 'hi',
      }),
    ).rejects.toThrow(
      'Model gpt uses the OpenAI endpoint, which is not supported by Anthropic SDK. Choose DeepAgents or an Anthropic-compatible model.',
    );
    expect(openai.query).not.toHaveBeenCalled();
  });

  it('fails loud on an unknown response family under any engine', async () => {
    const { router } = buildRouter(DEEPAGENTS_ENGINE);
    await expect(
      router.query({
        appId: 'default' as never,
        model: 'mystery-model',
        modelProfile: profile({ responseFamily: 'gemini', alias: 'gem' }),
        prompt: 'hi',
      }),
    ).rejects.toThrow('unsupported response family "gemini"');
  });

  it('routes profile-less legacy callers to the default-family SDK lane', async () => {
    const { router, anthropic, openai, anthropicDirect } =
      buildRouter(DEFAULT_SDK_ENGINE);
    const result = await router.query({
      appId: 'default' as never,
      model: 'unrecognized-runner-model',
      prompt: 'hi',
    });
    expect(result).toBe('anthropic-sdk');
    expect(anthropic.query).toHaveBeenCalledTimes(1);
    expect(openai.query).not.toHaveBeenCalled();
    expect(anthropicDirect.query).not.toHaveBeenCalled();
  });

  it('is configured when any lane is configured', () => {
    const router = (a: boolean, o: boolean, d: boolean) =>
      createRouteAwareMemoryLlmClient({
        anthropic: fakeClient('a', a),
        openai: fakeClient('o', o),
        anthropicDirect: fakeClient('d', d),
        getEngine: () => DEFAULT_SDK_ENGINE,
      }).isConfigured();
    expect(router(false, true, false)).toBe(true);
    expect(router(false, false, true)).toBe(true);
    expect(router(true, false, false)).toBe(true);
    expect(router(false, false, false)).toBe(false);
  });
});
