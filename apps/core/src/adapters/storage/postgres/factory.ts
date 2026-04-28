import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createStorageService,
  type ResolvedStorageConfig,
} from './storage-service.js';
import {
  createPostgresDomainRepositories,
  type PostgresDomainRepositoryBundle,
} from './repositories/domain-repositories.postgres.js';
import {
  ARTIFACTS_DIR,
  STORAGE_POSTGRES_SCHEMA,
  STORAGE_POSTGRES_URL,
  STORAGE_POSTGRES_URL_ENV,
  getRuntimeSettingsForConfig,
} from '../../../config/index.js';
import { PostgresProviderArtifactStore } from '../../artifacts/postgres/postgres-provider-artifact-store.js';
import type { OpsRepository } from '../../../domain/repositories/ops-repo.js';
import type { ProviderArtifactStore } from '../../../domain/ports/provider-artifact-store.js';
import { PostgresCanonicalOpsRepository } from './schema/canonical-ops-repo.postgres.js';
import { PostgresControlPlaneRepository } from './schema/control-plane-repo.postgres.js';
import type { PostgresStorageService } from './storage-service.js';
import { LocalSkillAssetStore } from '../../artifacts/skills/local-skill-asset-store.js';
import type { SkillAssetStore } from '../../../domain/ports/skill-asset-store.js';

export interface StorageRuntime {
  service: PostgresStorageService;
  ops: OpsRepository;
  control: PostgresControlPlaneRepository;
  repositories: PostgresDomainRepositoryBundle;
  providerArtifacts: ProviderArtifactStore;
  skillAssets: SkillAssetStore;
}

function resolvePackageRootFromHere(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) return current;
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

export function resolveStorageConfigFromRuntime(): ResolvedStorageConfig {
  return {
    postgresUrl: STORAGE_POSTGRES_URL,
    postgresUrlEnv: STORAGE_POSTGRES_URL_ENV,
    postgresSchema: STORAGE_POSTGRES_SCHEMA,
  };
}

export function createStorageRuntime(
  config: ResolvedStorageConfig = resolveStorageConfigFromRuntime(),
): StorageRuntime {
  const service = createStorageService(config, {
    artifactRoot: ARTIFACTS_DIR,
    packageRoot: resolvePackageRootFromHere(),
  });
  const sessionSettings = getRuntimeSettingsForConfig().agent.sessions;
  const ops: OpsRepository = new PostgresCanonicalOpsRepository(
    service.pool,
    service.db,
    { sessions: sessionSettings },
  );
  const control = new PostgresControlPlaneRepository(service.pool);
  const repositories = createPostgresDomainRepositories(service.db);
  const providerArtifacts = new PostgresProviderArtifactStore(service.db, {
    artifactRoot: ARTIFACTS_DIR,
    defaultStorageType: 'local-filesystem',
  });
  const skillAssets = new LocalSkillAssetStore(ARTIFACTS_DIR);
  return {
    service,
    ops,
    control,
    repositories,
    providerArtifacts,
    skillAssets,
  };
}
