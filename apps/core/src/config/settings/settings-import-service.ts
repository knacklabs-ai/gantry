import type { Pool } from 'pg';

import type { AppId } from '../../domain/app/app.js';
import type { SettingsRevisionRepository } from '../../domain/ports/fleet-capability-state.js';
import { SettingsDesiredStateService } from './desired-state-service.js';
import type {
  SettingsDesiredStateOps,
  SettingsDesiredStateRepositories,
} from './desired-state-service.js';
import { applyRuntimeSettingsDesiredState } from './restart-sync.js';
import { parseRuntimeSettingsObject } from './runtime-settings-parser.js';
import { renderRuntimeSettingsYaml } from './runtime-settings-renderer.js';
import { parseSimpleYamlObject } from './yaml.js';
import { validateLoadedRuntimeSettings } from './runtime-settings-validation.js';
import type { RuntimeSettings } from './runtime-settings-types.js';
import {
  PostgresSettingsRevisionNotifier,
  type SettingsRevisionWakeup,
} from './settings-revision-notify.js';

/**
 * Reader version of the settings-revision contract this build understands. A
 * revision stamped with a higher `min_reader_version` than this is held (not
 * applied) by an older worker until it is upgraded (ADR-3 skew safety contract).
 * Bump this whenever a settings-schema change would break older readers.
 */
export const CURRENT_SETTINGS_READER_VERSION = 1;

export interface SettingsImportValidationResult {
  ok: boolean;
  settings: RuntimeSettings;
  /** Path-level error strings, identical for the YAML and API surfaces. */
  errors: string[];
}

export interface SettingsImportServiceDeps {
  runtimeHome: string;
  ops: SettingsDesiredStateOps;
  repositories: SettingsDesiredStateRepositories;
  appId?: AppId;
}

/**
 * The single validation path shared by every settings mutation surface (YAML
 * watcher auto-import, CLI `settings import`, and the control-API desired-state
 * update). Schema/path-level validation runs through `validateLoadedRuntimeSettings`
 * and capability-reference validation runs through the desired-state service, so
 * the workstation file and the fleet revision produce identical errors (ADR-3:
 * one mutation path, one validation, no authority fork).
 */
export async function validateSettingsForImport(
  deps: SettingsImportServiceDeps,
  settings: RuntimeSettings,
): Promise<SettingsImportValidationResult> {
  const errors: string[] = [];
  const schema = validateLoadedRuntimeSettings(deps.runtimeHome, settings);
  if (!schema.ok && schema.failure) {
    errors.push(...schema.failure.details);
  }
  const service = new SettingsDesiredStateService({
    ops: deps.ops,
    repositories: deps.repositories,
    appId: deps.appId,
  });
  const invalidReferences =
    await service.validateCapabilityReferences(settings);
  errors.push(...invalidReferences);
  return { ok: errors.length === 0, settings, errors };
}

/**
 * Workstation import: validate, then write `settings.yaml` and reconcile through
 * the existing desired-state apply path (unchanged behavior). `settings.yaml`
 * remains the restart source of truth for workstation (AGENTS.md). Throws a
 * combined path-level error message on validation failure.
 */
export async function importWorkstationSettings(
  deps: SettingsImportServiceDeps & {
    previousSettings?: RuntimeSettings;
    reloadRuntimeState?: () => Promise<void>;
  },
  settings: RuntimeSettings,
): Promise<void> {
  const validation = await validateSettingsForImport(deps, settings);
  if (!validation.ok) {
    throw new Error(
      ['settings validation failed.', ...validation.errors].join('\n'),
    );
  }
  await applyRuntimeSettingsDesiredState({
    runtimeHome: deps.runtimeHome,
    settings,
    ops: deps.ops,
    repositories: deps.repositories,
    appId: deps.appId,
    previousSettings: deps.previousSettings,
    reloadRuntimeState: deps.reloadRuntimeState,
  });
}

export type FleetImportOutcome =
  | { status: 'applied'; revision: number }
  | { status: 'invalid'; errors: string[] }
  | { status: 'conflict'; expectedRevision: number; actualRevision: number };

export interface FleetImportDeps extends SettingsImportServiceDeps {
  settingsRevisions: SettingsRevisionRepository;
  /** Pool used to publish the `pg_notify` wakeup after a successful append. */
  pool?: Pool;
  createdBy: string;
  logWarn?: (context: Record<string, unknown>, message: string) => void;
}

/**
 * Fleet import: validate through the same path, enforce stale-revision
 * optimistic concurrency, append a `settings_revisions` row carrying
 * `CURRENT_SETTINGS_READER_VERSION`, and publish a `pg_notify` wakeup. Workers
 * converge by fetching the latest revision (NOTIFY + poll fallback). The
 * desired-state authority in fleet is Postgres, not the file (ADR-3).
 */
export async function importFleetSettingsRevision(
  deps: FleetImportDeps,
  settings: RuntimeSettings,
  options: { expectedRevision?: number | null; note?: string | null } = {},
): Promise<FleetImportOutcome> {
  const validation = await validateSettingsForImport(deps, settings);
  if (!validation.ok) {
    return { status: 'invalid', errors: validation.errors };
  }
  const appId = deps.appId ?? ('default' as AppId);
  // Optimistic concurrency lives in the repository: with expectedRevision the
  // append is a conditional insert at exactly expectedRevision + 1 — no
  // check-then-act window, no retry past a conflict. The loser of a concurrent
  // same-expectation race gets the contracted conflict, never a silent append.
  const appended = await deps.settingsRevisions.appendSettingsRevision({
    appId,
    settingsDocument: settingsToRevisionDocument(settings),
    minReaderVersion: CURRENT_SETTINGS_READER_VERSION,
    createdBy: deps.createdBy,
    note: options.note ?? null,
    expectedRevision: options.expectedRevision ?? null,
  });
  if (appended.status === 'conflict') {
    return {
      status: 'conflict',
      expectedRevision: appended.expectedRevision,
      actualRevision: appended.actualRevision,
    };
  }
  if (deps.pool) {
    const notifier = new PostgresSettingsRevisionNotifier(
      deps.pool,
      deps.logWarn,
    );
    const wakeup: SettingsRevisionWakeup = {
      appId,
      revision: appended.revision.revision,
    };
    await notifier.notifyRevisionChanged(wakeup);
  }
  return { status: 'applied', revision: appended.revision.revision };
}

/**
 * Serialize desired state into the typed JSON settings document that the
 * control API/SDK transport and `settings_revisions` store as jsonb. YAML is the
 * human file format for the workstation file + CLI `--file` edge only; it never
 * appears on the wire. The document is the parser's native (snake_case) object
 * form, so workers re-hydrate through the exact same structural-validation path
 * the file surface uses — single-validation-path, with round-trip behavior
 * identical to the file surface (including the file surface's pre-existing
 * escaping limits for string values containing `"` or `\`).
 */
export function settingsToRevisionDocument(
  settings: RuntimeSettings,
): Record<string, unknown> {
  return parseSimpleYamlObject(renderRuntimeSettingsYaml(settings));
}

/** Re-hydrate a typed settings document back into typed runtime settings. */
export function settingsFromRevisionDocument(
  document: Record<string, unknown>,
): RuntimeSettings {
  return parseRuntimeSettingsObject(document);
}
