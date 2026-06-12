import type {
  MemoryLlmClient,
  MemoryLlmQueryOpts,
} from '../../domain/ports/memory-llm-client.js';
import { findModelByRunnerModel } from '../../shared/model-catalog.js';

/**
 * Route-aware memory LLM client. Memory is system-owned host work: there is no
 * agent engine in scope, so each query is dispatched by the *model's* response
 * family (OpenAI vs the default Anthropic family), never by an agent engine.
 *
 * - OpenAI-family routes use the fetch-based Chat Completions client.
 * - The Anthropic family (including OpenRouter, which is Anthropic-compatible
 *   route metadata) and legacy callers that pass only a runner model use the
 *   default Anthropic memory client.
 * - Any other known-but-unsupported response family fails loudly so a misrouted
 *   model surfaces immediately instead of silently using the wrong transport.
 *
 * Both lanes resolve credentials through the same Gantry model-gateway broker
 * authority; the router only chooses which transport speaks to the gateway.
 */
const DEFAULT_RESPONSE_FAMILY = 'anthropic';

export interface RouteAwareMemoryLlmClientDeps {
  anthropic: MemoryLlmClient;
  openai: MemoryLlmClient;
}

export function createRouteAwareMemoryLlmClient(
  deps: RouteAwareMemoryLlmClientDeps,
): MemoryLlmClient {
  return {
    isConfigured: () =>
      deps.anthropic.isConfigured() || deps.openai.isConfigured(),
    query: async (opts) => clientForQuery(deps, opts).query(opts),
  };
}

function clientForQuery(
  deps: RouteAwareMemoryLlmClientDeps,
  opts: MemoryLlmQueryOpts,
): MemoryLlmClient {
  const family = resolveResponseFamily(opts) ?? DEFAULT_RESPONSE_FAMILY;
  if (family === 'openai') return deps.openai;
  if (family === DEFAULT_RESPONSE_FAMILY) return deps.anthropic;
  throw new Error(
    `Memory model "${opts.model}" has unsupported response family "${family}". Memory supports the Anthropic and OpenAI families only.`,
  );
}

function resolveResponseFamily(opts: MemoryLlmQueryOpts): string | undefined {
  if (opts.modelProfile?.responseFamily) {
    return opts.modelProfile.responseFamily;
  }
  const entry =
    findModelByRunnerModel(opts.model) ??
    findModelByRunnerModel(opts.modelProfile?.runnerModel);
  return entry?.responseFamily;
}
