import { GANTRY_HOME } from '../index.js';
import type { SettingsRevisionRepository } from '../../domain/ports/fleet-capability-state.js';
import type { RuntimeConversationRouteRepository } from '../../domain/repositories/ops-repo.js';
import type {
  SettingsDesiredStateActions,
  SettingsDesiredStateRepositories,
} from '../../domain/ports/settings-desired-state.js';
import { mirrorAgentToolRulesToRuntimeSettings } from './runtime-settings.js';
import {
  addAgentToolRulesToSyncedRuntimeSettings,
  removeAgentToolRulesFromSyncedRuntimeSettings,
} from './restart-sync.js';

export type AgentToolRuleSettingsRepositories =
  SettingsDesiredStateRepositories & {
    settingsRevisions?: SettingsRevisionRepository;
  };

export function createAgentToolRuleSettingsMirror(input: {
  desiredState: SettingsDesiredStateActions;
  opsRepository: RuntimeConversationRouteRepository;
  repositories?: AgentToolRuleSettingsRepositories;
  reloadRuntimeState: () => Promise<void>;
}): (
  sourceAgentFolder: string,
  rules: string[],
  options?: { appId?: string; mode?: 'add' | 'remove' },
) => Promise<void> | void {
  return (sourceAgentFolder, rules, options) => {
    if (input.repositories) {
      const shared = {
        runtimeHome: GANTRY_HOME,
        desiredState: input.desiredState,
        agentFolder: sourceAgentFolder,
        rules,
        ops: input.opsRepository,
        repositories: input.repositories,
        appId: options?.appId as never,
        reloadRuntimeState: input.reloadRuntimeState,
        settingsRevisions: input.repositories.settingsRevisions,
      };
      return options?.mode === 'remove'
        ? removeAgentToolRulesFromSyncedRuntimeSettings(shared)
        : addAgentToolRulesToSyncedRuntimeSettings(shared);
    }
    return mirrorAgentToolRulesToRuntimeSettings({
      runtimeHome: GANTRY_HOME,
      agentFolder: sourceAgentFolder,
      rules,
      mode: options?.mode,
    });
  };
}
