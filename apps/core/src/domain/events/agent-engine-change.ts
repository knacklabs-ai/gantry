import type { AppId } from '../app/app.js';
import type { AgentEngine } from '../../shared/agent-engine.js';

// Durable agent-engine change record + audit-sink contract. These live in the
// domain layer so both the settings choke point (config) that computes the diff
// and the runtime-wired publisher (Postgres adapter) that emits the
// AGENT_ENGINE_CHANGED event can depend on them without a config<->adapter edge.
// Engine values are public vocabulary, so nothing here is secret.
export interface AgentEngineChange {
  agentFolder: string;
  oldEngine: AgentEngine;
  newEngine: AgentEngine;
}

export interface AgentEngineChangeAuditContext {
  appId?: AppId;
  actor?: string;
  publish: (input: {
    appId?: AppId;
    actor?: string;
    change: AgentEngineChange;
  }) => Promise<void> | void;
}

// Durable memory-engine change record + audit-sink contract. Memory engine is a
// singleton runtime setting (`memory.engine`) governing all three memory
// workloads, so unlike the per-agent engine change it has no agentFolder — a
// sibling MEMORY_ENGINE_CHANGED event keeps both payloads clean rather than
// overloading AGENT_ENGINE_CHANGED with a subject discriminator. Engine values
// are public vocabulary, so nothing here is secret.
export interface MemoryEngineChange {
  oldEngine: AgentEngine;
  newEngine: AgentEngine;
}

export interface MemoryEngineChangeAuditContext {
  appId?: AppId;
  actor?: string;
  publish: (input: {
    appId?: AppId;
    actor?: string;
    change: MemoryEngineChange;
  }) => Promise<void> | void;
}
