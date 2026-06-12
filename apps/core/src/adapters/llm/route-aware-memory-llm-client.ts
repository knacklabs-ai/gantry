import type {
  MemoryLlmClient,
  MemoryLlmQueryOpts,
} from '../../domain/ports/memory-llm-client.js';
import { findModelByRunnerModel } from '../../shared/model-catalog.js';
import type { AgentEngine } from '../../shared/agent-engine.js';
import {
  DEFAULT_MEMORY_RESPONSE_FAMILY,
  resolveMemoryEngineRouting,
} from '../../shared/memory-engine-matrix.js';

/**
 * Route-aware memory LLM client. Memory is system-owned host work: there is no
 * agent engine in scope, so each query is dispatched by the configured memory
 * engine (`memory.engine`) crossed with the *model's* response family per the
 * memory engine matrix (shared/memory-engine-matrix.ts):
 *
 * - default engine + anthropic-family -> Claude Agent SDK memory client.
 * - default engine + openai-family    -> INVALID (OpenAI endpoint; locked copy).
 * - deepagents     + openai-family    -> OpenAI direct chat-completions client.
 * - deepagents     + anthropic-family -> Anthropic direct Messages client.
 *
 * The engine reaches the router through a getter (not a snapshot) so a reviewed
 * settings reload applies without restart. Any unknown response family fails
 * loudly so a misrouted model surfaces immediately. Both lanes resolve
 * credentials through the same Gantry model-gateway broker authority; the router
 * only chooses which transport speaks to the gateway.
 */
export interface RouteAwareMemoryLlmClientDeps {
  // Claude Agent SDK memory client (default engine + anthropic-family).
  anthropic: MemoryLlmClient;
  // OpenAI direct chat-completions client (deepagents + openai-family).
  openai: MemoryLlmClient;
  // Anthropic direct Messages client (deepagents + anthropic-family).
  anthropicDirect: MemoryLlmClient;
  // The configured memory engine, read fresh per query so reloads apply.
  getEngine: () => AgentEngine;
}

export function createRouteAwareMemoryLlmClient(
  deps: RouteAwareMemoryLlmClientDeps,
): MemoryLlmClient {
  return {
    isConfigured: () =>
      deps.anthropic.isConfigured() ||
      deps.openai.isConfigured() ||
      deps.anthropicDirect.isConfigured(),
    query: async (opts) => clientForQuery(deps, opts).query(opts),
  };
}

function clientForQuery(
  deps: RouteAwareMemoryLlmClientDeps,
  opts: MemoryLlmQueryOpts,
): MemoryLlmClient {
  const responseFamily =
    resolveResponseFamily(opts) ?? DEFAULT_MEMORY_RESPONSE_FAMILY;
  const routing = resolveMemoryEngineRouting({
    engine: deps.getEngine(),
    responseFamily,
    alias: opts.modelProfile?.alias ?? opts.model,
  });
  if (!routing.ok) {
    throw new Error(routing.message);
  }
  switch (routing.lane) {
    case 'native_sdk':
      return deps.anthropic;
    case 'openai_direct':
      return deps.openai;
    case 'anthropic_direct':
      return deps.anthropicDirect;
  }
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
