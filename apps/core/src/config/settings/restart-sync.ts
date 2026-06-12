import type { AppId } from '../../domain/app/app.js';
import type {
  SettingsDesiredStateOps,
  SettingsDesiredStateRepositories,
} from './desired-state-service.js';
import { SettingsDesiredStateService } from './desired-state-service.js';
import {
  addAgentToolRulesToRuntimeSettings,
  loadRuntimeSettings,
  removeAgentToolRulesFromRuntimeSettings,
  saveRuntimeSettings,
} from './runtime-settings.js';
import { normalizeConfiguredCapabilitiesInSettings } from './configured-capability-normalization.js';
import { validateLoadedRuntimeSettings } from './runtime-settings-validation.js';
import type { RuntimeSettings } from './runtime-settings-types.js';
import type { AgentEngine } from '../../shared/agent-engine.js';
import {
  diffAgentEngineChanges,
  diffMemoryEngineChange,
} from './agent-engine-change-audit.js';
import type {
  AgentEngineChangeAuditContext,
  MemoryEngineChangeAuditContext,
} from '../../domain/events/agent-engine-change.js';

// Re-exported so existing callers keep their import site; the canonical type and
// the AGENT_ENGINE_CHANGED audit-sink contract live in the domain layer so the
// Postgres-wired publisher can implement it without a config<->adapter edge.
export type { AgentEngineChangeAuditContext, MemoryEngineChangeAuditContext };

export async function applyRuntimeSettingsDesiredState(input: {
  runtimeHome: string;
  settings: RuntimeSettings;
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
  previousSettings?: RuntimeSettings;
  reloadRuntimeState?: () => Promise<void>;
  engineChangeAudit?: AgentEngineChangeAuditContext;
  memoryEngineChangeAudit?: MemoryEngineChangeAuditContext;
}): Promise<void> {
  const service = new SettingsDesiredStateService({
    ops: input.ops,
    repositories: input.repositories,
    appId: input.appId,
  });
  const normalization = await normalizeConfiguredCapabilitiesInSettings({
    settings: input.settings,
    repositories: input.repositories,
    appId: input.appId ?? ('default' as AppId),
  });
  const settings = normalization.settings;
  const reconcileSettings = normalization.changed ? input.settings : settings;
  const validation = validateLoadedRuntimeSettings(input.runtimeHome, settings);
  if (!validation.ok) {
    throw new Error(
      [
        validation.failure?.summary || 'settings.yaml validation failed.',
        ...(validation.failure?.details || []),
      ].join('\n'),
    );
  }
  const rollback = async () => {
    if (!input.previousSettings) return;
    saveRuntimeSettings(input.runtimeHome, input.previousSettings);
    await service.reconcile(input.previousSettings);
    await input.reloadRuntimeState?.();
  };
  try {
    saveRuntimeSettings(input.runtimeHome, settings);
    const reconcile = await service.reconcile(reconcileSettings);
    if (reconcile.invalidReferences.length > 0) {
      throw new Error(
        `settings desired state contains invalid references:\n${reconcile.invalidReferences.join('\n')}`,
      );
    }
    await input.reloadRuntimeState?.();
  } catch (err) {
    await rollback();
    throw err;
  }
  // Durable engine changes are audited after the write+reconcile+reload land so
  // the event reflects the persisted state. Audit failures must not fail the
  // settings write, so this is best-effort and outside the rollback try.
  await emitAgentEngineChangeAudit({
    previousSettings: input.previousSettings,
    settings,
    audit: input.engineChangeAudit,
  });
  await emitMemoryEngineChangeAudit({
    previousSettings: input.previousSettings,
    settings,
    audit: input.memoryEngineChangeAudit,
  });
}

async function emitMemoryEngineChangeAudit(input: {
  previousSettings: RuntimeSettings | undefined;
  settings: RuntimeSettings;
  audit?: MemoryEngineChangeAuditContext;
}): Promise<void> {
  if (!input.audit) return;
  const change = diffMemoryEngineChange(input.previousSettings, input.settings);
  if (!change) return;
  try {
    await input.audit.publish({
      appId: input.audit.appId,
      actor: input.audit.actor,
      change,
    });
  } catch {
    // Best-effort: a failed audit publish must not break the settings write.
  }
}

async function emitAgentEngineChangeAudit(input: {
  previousSettings: RuntimeSettings | undefined;
  settings: RuntimeSettings;
  audit?: AgentEngineChangeAuditContext;
}): Promise<void> {
  if (!input.audit) return;
  const changes = diffAgentEngineChanges(
    input.previousSettings,
    input.settings,
  );
  for (const change of changes) {
    try {
      await input.audit.publish({
        appId: input.audit.appId,
        actor: input.audit.actor,
        change,
      });
    } catch {
      // Best-effort: a failed audit publish must not break the settings write.
    }
  }
}

// Write a per-agent engine override into settings.yaml and reconcile in the
// same operation. Engine is durable only in settings (not a stored agent
// field), so this is the restart-owned write path shared by the CLI engine verb
// and the Control API PATCH. `applyRuntimeSettingsDesiredState` validates the
// document first, so an incompatible model/engine pairing throws the locked
// plan copy and no settings.yaml or reconcile write lands.
export async function setRuntimeAgentEngine(input: {
  runtimeHome: string;
  agentFolder: string;
  agentEngine: AgentEngine;
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
  reloadRuntimeState?: () => Promise<void>;
  engineChangeAudit?: AgentEngineChangeAuditContext;
}): Promise<void> {
  const previousSettings = loadRuntimeSettings(input.runtimeHome);
  const agent = previousSettings.agents[input.agentFolder];
  if (!agent) {
    throw new Error(
      `No configured agent named "${input.agentFolder}". Configure the agent before setting its engine.`,
    );
  }
  if (agent.agentEngine === input.agentEngine) return;
  const nextSettings = structuredClone(previousSettings);
  const nextAgent = nextSettings.agents[input.agentFolder];
  if (nextAgent) nextAgent.agentEngine = input.agentEngine;
  await applyRuntimeSettingsDesiredState({
    runtimeHome: input.runtimeHome,
    settings: nextSettings,
    previousSettings,
    ops: input.ops,
    repositories: input.repositories,
    appId: input.appId,
    reloadRuntimeState: input.reloadRuntimeState,
    engineChangeAudit: input.engineChangeAudit,
  });
}

export async function syncRuntimeSettingsFromProjection(input: {
  runtimeHome: string;
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
  reloadRuntimeState?: () => Promise<void>;
}): Promise<void> {
  const settings = loadRuntimeSettings(input.runtimeHome);
  const service = new SettingsDesiredStateService({
    ops: input.ops,
    repositories: input.repositories,
    appId: input.appId,
  });
  await applyRuntimeSettingsDesiredState({
    ...input,
    settings: await service.exportCurrent(settings),
    previousSettings: settings,
  });
}

export async function addAgentToolRulesToSyncedRuntimeSettings(input: {
  runtimeHome: string;
  agentFolder: string;
  rules: readonly string[];
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
  reloadRuntimeState?: () => Promise<void>;
}): Promise<void> {
  const previousSettings = loadRuntimeSettings(input.runtimeHome);
  const nextSettings = structuredClone(previousSettings);
  addAgentToolRulesToRuntimeSettings(
    nextSettings,
    input.agentFolder,
    input.rules,
  );
  await applyRuntimeSettingsDesiredState({
    runtimeHome: input.runtimeHome,
    settings: nextSettings,
    previousSettings,
    ops: input.ops,
    repositories: input.repositories,
    appId: input.appId,
    reloadRuntimeState: input.reloadRuntimeState,
  });
}

export async function removeAgentToolRulesFromSyncedRuntimeSettings(input: {
  runtimeHome: string;
  agentFolder: string;
  rules: readonly string[];
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
  reloadRuntimeState?: () => Promise<void>;
}): Promise<void> {
  const previousSettings = loadRuntimeSettings(input.runtimeHome);
  const nextSettings = structuredClone(previousSettings);
  removeAgentToolRulesFromRuntimeSettings(
    nextSettings,
    input.agentFolder,
    input.rules,
  );
  await applyRuntimeSettingsDesiredState({
    runtimeHome: input.runtimeHome,
    settings: nextSettings,
    previousSettings,
    ops: input.ops,
    repositories: input.repositories,
    appId: input.appId,
    reloadRuntimeState: input.reloadRuntimeState,
  });
}
