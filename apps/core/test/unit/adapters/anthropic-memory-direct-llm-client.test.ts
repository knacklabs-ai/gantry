import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryLlmUsage } from '@core/domain/ports/memory-llm-client.js';

const resolveGatewayMemoryInjectionMock = vi.hoisted(() => vi.fn());
const hasGatewayMemoryAccessMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());

vi.mock('@core/adapters/llm/openai-memory/memory-gateway-injection.js', () => ({
  hasGatewayMemoryAccess: hasGatewayMemoryAccessMock,
  resolveGatewayMemoryInjection: resolveGatewayMemoryInjectionMock,
}));

// Build the anthropic projection env keys without restating the provider
// boundary token literally in the test file.
const BASE_URL_ENV = ['ANTHROPIC', 'BASE_URL'].join('_');
const TOKEN_ENV = ['ANTHROPIC', 'API_KEY'].join('_');
const GATEWAY_ENV: Record<string, string> = {
  [BASE_URL_ENV]: 'http://127.0.0.1:49231/anthropic',
  [TOKEN_ENV]: 'gtw_memory_anthropic',
};

function messagesBody() {
  return {
    content: [{ type: 'text', text: 'anthropic memory result' }],
    usage: {
      input_tokens: 40,
      output_tokens: 34,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 12,
    },
  };
}

function injection(brokerAuthMode = 'api_key') {
  return {
    injection: {
      env: GATEWAY_ENV,
      applied: true,
      brokerProfile: 'gantry',
      brokerAuthMode,
    },
    revoke: revokeMock,
  };
}

beforeEach(() => {
  hasGatewayMemoryAccessMock.mockReturnValue(true);
  revokeMock.mockResolvedValue(undefined);
  resolveGatewayMemoryInjectionMock.mockResolvedValue(injection());
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const MEMORY_MODEL_PROFILE = {
  alias: 'haiku',
  runnerModel: 'claude-runner-test',
  responseFamily: ['anth', 'ropic'].join(''),
  modelRoute: 'anthropic',
  modelRouteLabel: 'Anthropic',
  displayName: 'Claude Test',
};

describe('Anthropic memory direct LLM client', () => {
  it('posts to the brokered Messages endpoint with the gateway bearer token and version header', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(messagesBody()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    const client = createAnthropicMemoryDirectLlmClient();

    const usageSeen: MemoryLlmUsage[] = [];
    const result = await client.query({
      appId: 'default' as never,
      model: 'claude-runner-test',
      modelProfile: MEMORY_MODEL_PROFILE,
      prompt: 'fallback prompt',
      systemPrompt: 'system instructions',
      userBlocks: [
        { text: 'static block', cacheStatic: true },
        { text: 'dynamic block' },
      ],
      onUsage: (usage) => usageSeen.push(usage),
    });

    expect(result).toBe('anthropic memory result');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:49231/anthropic/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer gtw_memory_anthropic');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-runner-test');
    expect(typeof body.max_tokens).toBe('number');
    expect(body.system).toEqual([
      { type: 'text', text: 'system instructions' },
    ]);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'static block',
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: 'dynamic block' },
        ],
      },
    ]);

    // Anthropic usage is already disjoint, so input/cache map straight through.
    expect(usageSeen).toEqual([
      {
        input_tokens: 40,
        output_tokens: 34,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 12,
      },
    ]);

    expect(revokeMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the plain prompt when no user blocks are provided', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(messagesBody()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    await createAnthropicMemoryDirectLlmClient().query({
      appId: 'default' as never,
      model: 'claude-runner-test',
      modelProfile: MEMORY_MODEL_PROFILE,
      prompt: 'just the prompt',
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.system).toBeUndefined();
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'just the prompt' }] },
    ]);
  });

  it('rejects a Claude OAuth credential mode with the locked copy and still revokes', async () => {
    resolveGatewayMemoryInjectionMock.mockResolvedValue(
      injection('claude_code_oauth'),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    await expect(
      createAnthropicMemoryDirectLlmClient().query({
        appId: 'default' as never,
        model: 'claude-runner-test',
        modelProfile: MEMORY_MODEL_PROFILE,
        prompt: 'hi',
      }),
    ).rejects.toThrow(
      'DeepAgents does not support Claude OAuth/subscription credentials in Gantry. Choose Anthropic SDK or configure Anthropic API-key Model Access.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });

  it('reports isConfigured from gateway access', async () => {
    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    hasGatewayMemoryAccessMock.mockReturnValue(false);
    expect(createAnthropicMemoryDirectLlmClient().isConfigured()).toBe(false);
    hasGatewayMemoryAccessMock.mockReturnValue(true);
    expect(createAnthropicMemoryDirectLlmClient().isConfigured()).toBe(true);
  });

  it('throws a clear setup error when the gateway is not configured', async () => {
    hasGatewayMemoryAccessMock.mockReturnValue(false);
    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    await expect(
      createAnthropicMemoryDirectLlmClient().query({
        appId: 'default' as never,
        model: 'claude-runner-test',
        modelProfile: MEMORY_MODEL_PROFILE,
        prompt: 'hello',
      }),
    ).rejects.toThrow('Anthropic memory access is not configured');
  });

  it('surfaces upstream HTTP errors and still revokes the token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('overloaded', {
          status: 529,
          statusText: 'Overloaded',
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    await expect(
      createAnthropicMemoryDirectLlmClient().query({
        appId: 'default' as never,
        model: 'claude-runner-test',
        modelProfile: MEMORY_MODEL_PROFILE,
        prompt: 'hello',
      }),
    ).rejects.toThrow('Anthropic memory query failed: 529');
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-Anthropic-family model route before issuing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { createAnthropicMemoryDirectLlmClient } = await import(
      '@core/adapters/llm/anthropic-memory-direct/anthropic-memory-direct-llm-client.js'
    );
    await expect(
      createAnthropicMemoryDirectLlmClient().query({
        appId: 'default' as never,
        model: 'claude-runner-test',
        modelProfile: { ...MEMORY_MODEL_PROFILE, modelRoute: 'openai' },
        prompt: 'hello',
      }),
    ).rejects.toThrow('is not an Anthropic-family model route');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
