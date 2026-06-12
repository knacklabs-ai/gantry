import type { AppId } from '../../../domain/app/app.js';
import { RUNTIME_EVENT_TYPES } from '../../../domain/events/runtime-event-types.js';
import { getRuntimeEventExchange } from './runtime-store.js';
import type {
  AgentEngineChangeAuditContext,
  MemoryEngineChangeAuditContext,
} from '../../../domain/events/agent-engine-change.js';

// Builds the runtime-wired audit sink for durable agent-engine changes. The pure
// diff + emission lives in config/settings (restart-sync.ts); this adapter-side
// factory supplies the publisher so config/settings stays free of Postgres/event
// dependencies. Every CLI verb, Control API PATCH, and settings import/reviewed
// update funnels through `applyRuntimeSettingsDesiredState`, which calls this.
//
// The emitted AGENT_ENGINE_CHANGED event carries agent id/folder, old engine,
// new engine, and actor/source. Engine values are public vocabulary, so the
// payload contains no secrets.
export function buildAgentEngineChangeAuditContext(input: {
  appId?: AppId;
  actor?: string;
  source?: string;
}): AgentEngineChangeAuditContext {
  return {
    appId: input.appId,
    actor: input.actor,
    publish: async ({ appId, actor, change }) => {
      await getRuntimeEventExchange().publish({
        appId: (appId ?? ('default' as AppId)) as AppId,
        eventType: RUNTIME_EVENT_TYPES.AGENT_ENGINE_CHANGED,
        actor: actor ?? 'runtime',
        responseMode: 'none',
        payload: {
          agentFolder: change.agentFolder,
          agentId: change.agentFolder,
          oldEngine: change.oldEngine,
          newEngine: change.newEngine,
          ...(input.source ? { source: input.source } : {}),
        },
      });
    },
  };
}

// Runtime-wired audit sink for the singleton memory engine setting. Emits one
// MEMORY_ENGINE_CHANGED event carrying old/new engine and actor/source. Memory
// engine governs all three memory workloads, so there is no per-agent subject.
// Engine values are public vocabulary, so the payload contains no secrets.
export function buildMemoryEngineChangeAuditContext(input: {
  appId?: AppId;
  actor?: string;
  source?: string;
}): MemoryEngineChangeAuditContext {
  return {
    appId: input.appId,
    actor: input.actor,
    publish: async ({ appId, actor, change }) => {
      await getRuntimeEventExchange().publish({
        appId: (appId ?? ('default' as AppId)) as AppId,
        eventType: RUNTIME_EVENT_TYPES.MEMORY_ENGINE_CHANGED,
        actor: actor ?? 'runtime',
        responseMode: 'none',
        payload: {
          oldEngine: change.oldEngine,
          newEngine: change.newEngine,
          ...(input.source ? { source: input.source } : {}),
        },
      });
    },
  };
}
