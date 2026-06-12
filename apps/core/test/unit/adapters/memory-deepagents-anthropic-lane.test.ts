import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultMemoryLlmClient } from '@core/adapters/llm/default-runtime-adapters.js';
import type { AgentEngine } from '@core/shared/agent-engine.js';

// End-to-end fixture for the DeepAgents + Anthropic-family memory lane: the real
// route-aware client wired with a deepagents engine getter must dispatch an
// extractor-shaped query (systemPrompt + cacheable userBlocks) through the
// Anthropic direct Messages client to the loopback gateway /v1/messages lane.

const resolveGatewayMemoryInjectionMock = vi.hoisted(() => vi.fn());
const hasGatewayMemoryAccessMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());

vi.mock('@core/adapters/llm/openai-memory/memory-gateway-injection.js', () => ({
  hasGatewayMemoryAccess: hasGatewayMemoryAccessMock,
  resolveGatewayMemoryInjection: resolveGatewayMemoryInjectionMock,
}));

const BASE_URL_ENV = ['ANTHROPIC', 'BASE_URL'].join('_');
const TOKEN_ENV = ['ANTHROPIC', 'API_KEY'].join('_');
const DEEPAGENTS_ENGINE = 'deepagents' as AgentEngine;

const MEMORY_MODEL_PROFILE = {
  alias: 'haiku',
  runnerModel: 'claude-runner-test',
  responseFamily: ['anth', 'ropic'].join(''),
  modelRoute: 'anthropic',
  modelRouteLabel: 'Anthropic',
  displayName: 'Claude Test',
};

beforeEach(() => {
  hasGatewayMemoryAccessMock.mockReturnValue(true);
  revokeMock.mockResolvedValue(undefined);
  resolveGatewayMemoryInjectionMock.mockResolvedValue({
    injection: {
      env: {
        [BASE_URL_ENV]: 'http://127.0.0.1:49231/anthropic',
        [TOKEN_ENV]: 'gtw_memory_anthropic',
      },
      applied: true,
      brokerProfile: 'gantry',
      brokerAuthMode: 'api_key',
    },
    revoke: revokeMock,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('memory deepagents + anthropic lane (extractor fixture)', () => {
  it('routes an extractor-shaped query to the Anthropic /v1/messages lane', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '[]' }],
            usage: { input_tokens: 12, output_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // Real router + real anthropic-direct client, with a deepagents engine getter.
    const client = createDefaultMemoryLlmClient(() => DEEPAGENTS_ENGINE);

    const result = await client.query({
      appId: 'default' as never,
      model: 'claude-runner-test',
      modelProfile: MEMORY_MODEL_PROFILE,
      prompt: 'plain fallback',
      systemPrompt: 'You extract memory facts.',
      userBlocks: [
        { text: 'few-shot examples', cacheStatic: true },
        { text: 'session arc to extract from' },
      ],
    });

    expect(result).toBe('[]');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:49231/anthropic/v1/messages');
    expect(init.headers.authorization).toBe('Bearer gtw_memory_anthropic');

    const body = JSON.parse(init.body as string);
    expect(body.system).toEqual([
      { type: 'text', text: 'You extract memory facts.' },
    ]);
    expect(body.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'few-shot examples',
      cache_control: { type: 'ephemeral' },
    });
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });
});
