import type { AppId } from '../../domain/app/app.js';
import type {
  SettingsDesiredStateOps,
  SettingsDesiredStateRepositories,
} from './desired-state-service.js';
import { SettingsDesiredStateService } from './desired-state-service.js';
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
} from './runtime-settings.js';

export async function syncRuntimeSettingsFromProjection(input: {
  runtimeHome: string;
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
}): Promise<void> {
  const settings = loadRuntimeSettings(input.runtimeHome);
  const service = new SettingsDesiredStateService({
    ops: input.ops,
    repositories: input.repositories,
    appId: input.appId,
  });
  saveRuntimeSettings(input.runtimeHome, await service.exportCurrent(settings));
}
