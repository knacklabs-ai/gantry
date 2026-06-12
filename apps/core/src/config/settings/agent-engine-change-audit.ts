import {
  resolveAgentEngine,
  type AgentEngine,
} from '../../shared/agent-engine.js';
import type {
  AgentEngineChange,
  MemoryEngineChange,
} from '../../domain/events/agent-engine-change.js';
import type { RuntimeSettings } from './runtime-settings-types.js';

// Pure diff of durable agent-engine changes between two settings documents. Both
// the CLI verb and the Control API PATCH funnel through
// `applyRuntimeSettingsDesiredState`, which is the single choke point that holds
// the previous and next settings; this computes which agents had their effective
// engine change so an AGENT_ENGINE_CHANGED audit event can be emitted per agent.
// No secrets are involved — engine values are public vocabulary.

function effectiveEngineForAgent(
  settings: RuntimeSettings,
  agentFolder: string,
): AgentEngine {
  const perAgent = settings.agents[agentFolder]?.agentEngine;
  return resolveAgentEngine(perAgent ?? settings.agent.defaultAgentEngine);
}

// Returns one entry per agent whose effective engine differs between the two
// documents. Agents present in either document are considered; an agent removed
// from the next document is not reported (its run lifecycle ends with removal).
// A default-engine change that flips an inheriting agent's effective engine is
// reported for each affected agent, matching how runs resolve the engine.
export function diffAgentEngineChanges(
  previousSettings: RuntimeSettings | undefined,
  settings: RuntimeSettings,
): AgentEngineChange[] {
  if (!previousSettings) return [];
  const changes: AgentEngineChange[] = [];
  for (const agentFolder of Object.keys(settings.agents)) {
    if (!previousSettings.agents[agentFolder]) continue;
    const oldEngine = effectiveEngineForAgent(previousSettings, agentFolder);
    const newEngine = effectiveEngineForAgent(settings, agentFolder);
    if (oldEngine !== newEngine) {
      changes.push({ agentFolder, oldEngine, newEngine });
    }
  }
  return changes;
}

// Pure diff of the durable memory-engine setting between two documents. Memory
// engine is a singleton (`memory.engine`); a change emits one
// MEMORY_ENGINE_CHANGED event. Returns undefined when unchanged or when there is
// no previous document to diff against.
export function diffMemoryEngineChange(
  previousSettings: RuntimeSettings | undefined,
  settings: RuntimeSettings,
): MemoryEngineChange | undefined {
  if (!previousSettings) return undefined;
  const oldEngine = previousSettings.memory.engine;
  const newEngine = settings.memory.engine;
  if (oldEngine === newEngine) return undefined;
  return { oldEngine, newEngine };
}
