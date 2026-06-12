import { randomUUID } from 'node:crypto';

import type {
  MemoryLlmClient,
  MemoryLlmQueryOpts,
  MemoryLlmUsage,
} from '../../../domain/ports/memory-llm-client.js';
import type { AgentRunId } from '../../../domain/events/events.js';
import { runWithMemoryOperationTimeout } from '../../../shared/memory-dreaming-timeout.js';
import {
  findModelByRunnerModel,
  type ModelRouteId,
} from '../../../shared/model-catalog.js';
import {
  getModelProviderDefinition,
  type ModelProviderDefinition,
} from '../../../shared/model-provider-registry.js';
import {
  hasGatewayMemoryAccess,
  resolveGatewayMemoryInjection,
} from '../openai-memory/memory-gateway-injection.js';

/**
 * Direct Anthropic Messages memory client for the DeepAgents engine. It speaks
 * the Anthropic Messages API (`/v1/messages`) over plain fetch (no
 * LangChain/DeepAgents/Anthropic SDK dependency) through the Gantry loopback
 * model gateway, using the same broker authority lane as the OpenAI memory
 * client. Selected only when memory.engine = deepagents AND the model resolves
 * to the Anthropic response family; the Anthropic SDK engine keeps the Claude
 * Agent SDK memory client.
 *
 * The gateway authenticates the run-scoped `gtw_` token as an inbound bearer and
 * injects the downstream x-api-key itself, so this client always sends
 * `Authorization: Bearer <gtw_token>`. Only api_key credential mode reaches this
 * lane (the deepagents Anthropic route declares supportedCredentialModes:
 * ['api_key']); a Claude OAuth/subscription credential is rejected upstream when
 * the gateway resolves the bound auth mode.
 */
const ANTHROPIC_MESSAGES_API_VERSION = '2023-06-01';
const DEFAULT_MEMORY_MAX_OUTPUT_TOKENS = 4096;

const ANTHROPIC_OAUTH_MEMORY_MESSAGE =
  'DeepAgents does not support Claude OAuth/subscription credentials in Gantry. Choose Anthropic SDK or configure Anthropic API-key Model Access.';

export function createAnthropicMemoryDirectLlmClient(): MemoryLlmClient {
  return {
    isConfigured: hasGatewayMemoryAccess,
    query: runAnthropicMemoryDirectQuery,
  };
}

interface MessagesTextBlock {
  type?: string;
  text?: string | null;
}

interface MessagesResponse {
  content?: MessagesTextBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

async function runAnthropicMemoryDirectQuery(
  opts: MemoryLlmQueryOpts,
): Promise<string> {
  if (!hasGatewayMemoryAccess()) {
    throw new Error(
      'Anthropic memory access is not configured (configure brokered model access)',
    );
  }
  return runWithMemoryOperationTimeout(
    (signal) => runWithGantryGateway({ ...opts, signal }),
    {
      timeoutMs: opts.timeoutMs,
      parentSignal: opts.signal,
      label: 'memory LLM query',
    },
  );
}

async function runWithGantryGateway(opts: MemoryLlmQueryOpts): Promise<string> {
  opts.signal?.throwIfAborted();
  const modelEntry = opts.modelProfile
    ? findModelByRunnerModel(opts.modelProfile.runnerModel)
    : findModelByRunnerModel(opts.model);
  const routeId: ModelRouteId =
    (opts.modelProfile?.modelRoute as ModelRouteId | undefined) ??
    modelEntry?.modelRoute.id ??
    'anthropic';
  const provider = requireAnthropicFamilyProvider(routeId);
  const runId = `memory-query:${randomUUID()}` as AgentRunId;
  const gateway = await resolveGatewayMemoryInjection({
    appId: opts.appId,
    modelRouteId: routeId,
    runId,
  });
  try {
    opts.signal?.throwIfAborted();
    assertApiKeyOnly(gateway.injection.brokerAuthMode);
    const { baseUrl, token } = readGatewayProjection(
      provider,
      gateway.injection.env,
    );
    const body = JSON.stringify({
      model: opts.model,
      max_tokens: DEFAULT_MEMORY_MAX_OUTPUT_TOKENS,
      ...buildMessagesRequest(opts),
    });
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-version': ANTHROPIC_MESSAGES_API_VERSION,
        'content-type': 'application/json',
      },
      body,
      signal: opts.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(
        `Anthropic memory query failed: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ''
        }`,
      );
    }
    const parsed = (await response.json()) as MessagesResponse;
    opts.signal?.throwIfAborted();
    reportUsage(opts.onUsage, parsed.usage);
    return readMessageText(parsed).trim();
  } finally {
    await gateway.revoke();
  }
}

function buildMessagesRequest(opts: MemoryLlmQueryOpts): {
  system?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: Array<{ role: 'user'; content: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> }>;
} {
  const system = opts.systemPrompt?.trim()
    ? [{ type: 'text' as const, text: opts.systemPrompt.trim() }]
    : undefined;
  const content = opts.userBlocks?.length
    ? opts.userBlocks.map((block) => ({
        type: 'text' as const,
        text: block.text,
        ...(block.cacheStatic
          ? { cache_control: { type: 'ephemeral' as const } }
          : {}),
      }))
    : [{ type: 'text' as const, text: opts.prompt }];
  return {
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content }],
  };
}

function readMessageText(response: MessagesResponse): string {
  let out = '';
  for (const block of response.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      out += block.text;
    }
  }
  return out;
}

function reportUsage(
  onUsage: MemoryLlmQueryOpts['onUsage'],
  usage: MessagesResponse['usage'],
): void {
  if (!onUsage || !usage) return;
  // Anthropic usage already reports input_tokens, cache_read_input_tokens, and
  // cache_creation_input_tokens as DISJOINT counts (mirrors the Claude Agent SDK
  // memory client in anthropic-claude-agent/memory-query.ts:146-156), so they
  // map straight through with no subtraction.
  const normalized: MemoryLlmUsage = {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    ...(usage.cache_read_input_tokens
      ? { cache_read_input_tokens: usage.cache_read_input_tokens }
      : {}),
    ...(usage.cache_creation_input_tokens
      ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
      : {}),
  };
  onUsage(normalized);
}

function requireAnthropicFamilyProvider(
  routeId: ModelRouteId,
): ModelProviderDefinition {
  const provider = getModelProviderDefinition(routeId);
  if (!provider || provider.responseFamily !== 'anthropic') {
    throw new Error(
      `Memory model route ${routeId} is not an Anthropic-family model route.`,
    );
  }
  return provider;
}

// DeepAgents only supports Anthropic API-key memory credentials. When the broker
// resolves a Claude OAuth/subscription auth mode, reject with the locked copy at
// the point the credential mode is known (mirrors the deepagents execution
// adapter's brokerAuthMode guard in deepagents-langchain/credential-validation).
function assertApiKeyOnly(brokerAuthMode: string | undefined): void {
  if (brokerAuthMode && brokerAuthMode !== 'api_key') {
    throw new Error(ANTHROPIC_OAUTH_MEMORY_MESSAGE);
  }
}

function readGatewayProjection(
  provider: ModelProviderDefinition,
  env: Record<string, string>,
): { baseUrl: string; token: string } {
  const projection = provider.gateway.sdkProjection;
  const baseUrl = env[projection.baseUrlEnv];
  const token = env[projection.tokenEnv];
  if (!baseUrl || !token) {
    throw new Error(
      `Setup required: configure ${provider.label} Model Access before running memory on ${provider.id} models.`,
    );
  }
  if (!token.startsWith('gtw_')) {
    throw new Error(
      `Gantry Model Gateway projection for ${provider.label} memory must use a run-scoped gateway token.`,
    );
  }
  return { baseUrl, token };
}
