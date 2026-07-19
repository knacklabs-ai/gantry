import type { AppId } from '../../domain/app/app.js';
import type { SettingsRevisionRepository } from '../../domain/ports/fleet-capability-state.js';
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
} from './runtime-settings.js';
import { classifySettingsChanges } from '../../shared/settings-change-classification.js';
import {
  importWorkstationSettings,
  settingsFromRevisionDocument,
  type SettingsRevisionMirror,
} from './settings-import-service.js';
import type {
  SettingsDesiredStateActions,
  SettingsDesiredStateOps,
  SettingsDesiredStateRepositories,
} from '../../domain/ports/settings-desired-state.js';
import type { RuntimeSettings } from '../../shared/runtime-settings.js';

export interface DesiredSettingsWriteStorage {
  desiredState: SettingsDesiredStateActions;
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  settingsRevisions?: SettingsRevisionRepository;
  pool?: SettingsRevisionMirror['pool'];
  close?: () => Promise<void>;
}

export interface DesiredRuntimeSettingsWriteResult {
  reconciled: boolean;
  restartRequired: string[];
}

export function noteRestartRequired(input: {
  restartRequired?: readonly string[];
}): void {
  if (input.restartRequired?.length) {
    console.log(
      'This change requires a restart to take effect — run `gantry restart`.',
    );
  }
}

let storageProvider:
  | ((input?: {
      settings?: RuntimeSettings;
      appId?: AppId;
    }) => Promise<DesiredSettingsWriteStorage | undefined>)
  | undefined;

export function configureDesiredSettingsStorageProvider(
  provider:
    | ((input?: {
        settings?: RuntimeSettings;
        appId?: AppId;
      }) => Promise<DesiredSettingsWriteStorage | undefined>)
    | undefined,
): void {
  storageProvider = provider;
}

/**
 * Single desired-state write path.
 *
 * Postgres `settings_revisions` is the durable authority for managed runtime
 * settings. The local `settings.yaml` file is updated by the shared import path
 * after the revision append succeeds.
 */
export async function writeDesiredRuntimeSettings(input: {
  runtimeHome: string;
  settings: RuntimeSettings;
  previousSettings?: RuntimeSettings;
  appId?: AppId;
  createdBy?: string;
}): Promise<DesiredRuntimeSettingsWriteResult> {
  const deploymentMode = input.settings.runtime.deploymentMode;
  if (!storageProvider) {
    const previousSettings =
      input.previousSettings ?? loadRuntimeSettings(input.runtimeHome);
    const restartRequired = classifySettingsChanges(
      previousSettings,
      input.settings,
    ).restartRequired;
    saveRuntimeSettings(input.runtimeHome, input.settings);
    return { reconciled: false, restartRequired };
  }
  const appId = input.appId ?? ('default' as AppId);
  const storage = await storageProvider({ settings: input.settings, appId });
  if (!storage) {
    throw new Error(
      'Settings mutation requires runtime storage so settings_revisions can be durably appended.',
    );
  }
  if (!deploymentMode) {
    await storage.close?.();
    throw new Error(
      'Settings mutation requires runtime.deploymentMode when runtime storage is available.',
    );
  }
  if (!storage.settingsRevisions) {
    await storage.close?.();
    throw new Error(
      'Settings mutation requires the settings revisions repository.',
    );
  }
  try {
    const previousSettings =
      input.previousSettings ?? loadRuntimeSettings(input.runtimeHome);
    const restartRequired = classifySettingsChanges(
      previousSettings,
      input.settings,
    ).restartRequired;
    await importWorkstationSettings(
      {
        runtimeHome: input.runtimeHome,
        desiredState: storage.desiredState,
        ops: storage.ops,
        repositories: storage.repositories,
        appId,
        previousSettings,
        revisionMirror: {
          settingsRevisions: storage.settingsRevisions,
          pool: storage.pool,
          createdBy: input.createdBy ?? 'cli:desired-settings-write',
        },
        revisionMirrorRequired: true,
      },
      input.settings,
    );
    return { reconciled: true, restartRequired };
  } finally {
    await storage.close?.();
  }
}

export async function loadDesiredRuntimeSettingsForWrite(input: {
  runtimeHome: string;
  appId?: AppId;
  settings?: RuntimeSettings;
}): Promise<RuntimeSettings> {
  const fileSettings = input.settings ?? loadRuntimeSettings(input.runtimeHome);
  if (!storageProvider) return fileSettings;

  const appId = input.appId ?? ('default' as AppId);
  const storage = await storageProvider({ settings: fileSettings, appId });
  if (!storage) {
    throw new Error(
      'Settings mutation requires runtime storage so settings_revisions can be durably read.',
    );
  }
  try {
    if (!storage.settingsRevisions) return fileSettings;
    const latest =
      await storage.settingsRevisions.getLatestSettingsRevision(appId);
    if (!latest) return fileSettings;
    return settingsFromRevisionDocument(latest.settingsDocument);
  } finally {
    await storage.close?.();
  }
}
