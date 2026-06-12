import {
  agentEngineLabel,
  DEEPAGENTS_ENGINE,
  DEFAULT_AGENT_ENGINE,
  type AgentEngine,
} from './agent-engine.js';

// Single source of truth for the memory engine x model response-family matrix.
// Memory is system-owned host work governed by one engine (`memory.engine`) for
// all three workloads (extraction, dreaming, consolidation). The transport lane
// that actually speaks to the model gateway is chosen by (engine, responseFamily):
//
//   default SDK engine + default family   -> native SDK memory client
//   default SDK engine + secondary family -> INVALID (locked copy)
//   deepagents engine  + secondary family -> openai_direct lane
//   deepagents engine  + default family   -> anthropic_direct lane
//
// Both validation (settings) and dispatch (router) consult this so they cannot
// drift. Unknown response families fall through as `unsupported-family`.

export type MemoryLane = 'native_sdk' | 'openai_direct' | 'anthropic_direct';

export type MemoryEngineRouting =
  | { ok: true; lane: MemoryLane }
  | {
      ok: false;
      reason: 'secondary-on-default-sdk' | 'unsupported-family';
      message: string;
    };

// Response-family identifiers used by the model catalog/provider registry. The
// matrix keys off these to choose the memory transport lane. Exported so callers
// reference the family vocabulary without restating the literals.
export const DEFAULT_MEMORY_RESPONSE_FAMILY = 'anthropic';
export const SECONDARY_MEMORY_RESPONSE_FAMILY = 'openai';

// Locked copy: a secondary-endpoint memory model cannot run on the default SDK
// engine. Mirrors the agent-lane copy in model-execution-route.ts so the product
// vocabulary stays identical across agent and memory surfaces.
export function openAiOnDefaultSdkMessage(alias: string): string {
  return `Model ${alias} uses the OpenAI endpoint, which is not supported by Anthropic SDK. Choose DeepAgents or an Anthropic-compatible model.`;
}

function unsupportedFamilyMessage(
  alias: string,
  responseFamily: string,
): string {
  return `Memory model "${alias}" has unsupported response family "${responseFamily}". Memory supports the Anthropic and OpenAI families only.`;
}

// Resolves the memory transport lane for a (engine, responseFamily) pair.
// `alias` is only used to build the user-facing rejection copy.
export function resolveMemoryEngineRouting(input: {
  engine: AgentEngine;
  responseFamily: string;
  alias: string;
}): MemoryEngineRouting {
  const { engine, responseFamily, alias } = input;
  if (responseFamily === SECONDARY_MEMORY_RESPONSE_FAMILY) {
    if (engine === DEFAULT_AGENT_ENGINE) {
      return {
        ok: false,
        reason: 'secondary-on-default-sdk',
        message: openAiOnDefaultSdkMessage(alias),
      };
    }
    return { ok: true, lane: 'openai_direct' };
  }
  if (responseFamily === DEFAULT_MEMORY_RESPONSE_FAMILY) {
    return {
      ok: true,
      lane: engine === DEEPAGENTS_ENGINE ? 'anthropic_direct' : 'native_sdk',
    };
  }
  return {
    ok: false,
    reason: 'unsupported-family',
    message: unsupportedFamilyMessage(alias, responseFamily),
  };
}

// Human-readable engine label for surfaces (CLI/preview) that print the memory
// engine. Re-exported from the engine vocabulary so callers import one module.
export function memoryEngineLabel(engine: AgentEngine): string {
  return agentEngineLabel(engine);
}
