import type { RuntimeSettings } from './runtime-settings.js';

export interface SettingsChangeClassification {
  liveApplied: string[];
  restartRequired: string[];
}

export function classifySettingsChanges(
  before: RuntimeSettings,
  after: RuntimeSettings,
): SettingsChangeClassification {
  const liveApplied: string[] = [];
  const restartRequired: string[] = [];

  if (!jsonEqual(before.storage, after.storage)) {
    restartRequired.push('storage');
  }
  if (!jsonEqual(before.credentialBroker, after.credentialBroker)) {
    restartRequired.push('model_access');
  }
  const providerTopologyChanged = !jsonEqual(
    providerTopology(before),
    providerTopology(after),
  );
  if (providerTopologyChanged) {
    restartRequired.push('providers');
  }
  if (
    !providerTopologyChanged &&
    !jsonEqual(before.conversations, after.conversations)
  ) {
    liveApplied.push('conversation_policies');
  }
  if (!jsonEqual(before.agent, after.agent)) {
    liveApplied.push('agent_defaults');
  }
  if (!jsonEqual(before.agents, after.agents)) {
    restartRequired.push('agents');
  }
  if (!jsonEqual(before.memory, after.memory)) {
    restartRequired.push('memory');
  }
  if (!jsonEqual(before.runtime, after.runtime)) {
    restartRequired.push('runtime');
  }
  if (!jsonEqual(before.observability, after.observability)) {
    restartRequired.push('observability');
  }

  return {
    liveApplied: [...new Set(liveApplied)].sort(),
    restartRequired: [...new Set(restartRequired)].sort(),
  };
}

function providerTopology(settings: RuntimeSettings): Record<string, unknown> {
  return {
    providers: settings.providers,
    providerAccounts: settings.providerAccounts,
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
