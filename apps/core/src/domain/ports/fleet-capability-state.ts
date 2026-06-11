export type RuntimeDependencyStatus =
  | 'queued'
  | 'baking'
  | 'uploaded'
  | 'activated'
  | 'failed';

export interface RuntimeDependencyArtifact {
  storageType: 'local-filesystem' | 'object-store';
  storageRef: string;
  contentHash: string;
  sizeBytes: number;
}

export interface RuntimeDependency {
  id: string;
  appId: string;
  /** Bake idempotency key. One manifest per (appId, manifestHash). */
  manifestHash: string;
  /** npm-only package specs (e.g. ["left-pad@1.3.0"]). */
  requestedPackages: string[];
  status: RuntimeDependencyStatus;
  artifact: RuntimeDependencyArtifact | null;
  failureReason: string | null;
  requestedByAgentId: string | null;
  approvedByConversationId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeDependencyRepository {
  /**
   * Idempotent on (appId, manifestHash): a duplicate create returns the
   * existing manifest row rather than starting a second bake.
   */
  createRuntimeDependency(input: {
    id: string;
    appId: string;
    manifestHash: string;
    requestedPackages: string[];
    requestedByAgentId?: string | null;
    approvedByConversationId?: string | null;
    approvedAt?: string | null;
    now?: string;
  }): Promise<RuntimeDependency>;
  getRuntimeDependency(id: string): Promise<RuntimeDependency | null>;
  getRuntimeDependencyByManifestHash(input: {
    appId: string;
    manifestHash: string;
  }): Promise<RuntimeDependency | null>;
  listRuntimeDependencies(input: {
    appId: string;
    statuses?: RuntimeDependencyStatus[];
  }): Promise<RuntimeDependency[]>;
  /**
   * Status-transition writer used by later bake/reconciler chunks. Sets the
   * status and any produced artifact/failure metadata. Returns false when the
   * row no longer exists.
   */
  updateRuntimeDependencyStatus(input: {
    id: string;
    status: RuntimeDependencyStatus;
    artifact?: RuntimeDependencyArtifact | null;
    failureReason?: string | null;
    now?: string;
  }): Promise<boolean>;
}

export interface SettingsRevision {
  appId: string;
  /** Monotonic per appId, allocated transactionally on append. */
  revision: number;
  settingsDocument: Record<string, unknown>;
  minReaderVersion: number;
  createdBy: string;
  note: string | null;
  createdAt: string;
}

export interface SettingsRevisionRepository {
  /**
   * Append a new desired-state revision. The next revision number is allocated
   * transactionally; concurrent appends serialize on the (appId, revision)
   * unique key and retry against the latest.
   */
  appendSettingsRevision(input: {
    appId: string;
    settingsDocument: Record<string, unknown>;
    minReaderVersion: number;
    createdBy: string;
    note?: string | null;
    now?: string;
  }): Promise<SettingsRevision>;
  getLatestSettingsRevision(appId: string): Promise<SettingsRevision | null>;
  getSettingsRevision(input: {
    appId: string;
    revision: number;
  }): Promise<SettingsRevision | null>;
  listRecentSettingsRevisions(input: {
    appId: string;
    limit: number;
  }): Promise<SettingsRevision[]>;
}
