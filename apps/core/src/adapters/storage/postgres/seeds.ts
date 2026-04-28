import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { LocalSkillAssetStore } from '../../artifacts/skills/local-skill-asset-store.js';
import * as pgSchema from './schema/schema.js';

export const DEFAULT_APP_ID = 'default';
export const DEFAULT_AGENT_ID = 'agent:personal';
export const DEFAULT_LLM_PROFILE_ID = 'llm:default';
export const DEFAULT_PERMISSION_POLICY_ID = 'permission-policy:default';
export const DEFAULT_SANDBOX_PROFILE_ID = 'sandbox-profile:local-dev';

export async function seedDefaultRuntimeData(
  db: NodePgDatabase<typeof pgSchema>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(pgSchema.appsPostgres)
      .values({
        id: DEFAULT_APP_ID,
        slug: 'personal',
        name: 'Default Personal App',
      })
      .onConflictDoUpdate({
        target: pgSchema.appsPostgres.id,
        set: {
          slug: 'personal',
          name: 'Default Personal App',
          updatedAt: sql`now()`,
        },
      });

    await tx
      .insert(pgSchema.llmProfilesPostgres)
      .values({
        id: DEFAULT_LLM_PROFILE_ID,
        appId: DEFAULT_APP_ID,
        purpose: 'default',
        provider: 'anthropic',
        modelAlias: 'default',
        thinkingJson: '{}',
        budgetJson: '{}',
      })
      .onConflictDoNothing();

    await tx
      .insert(pgSchema.sandboxProfilesPostgres)
      .values({
        id: DEFAULT_SANDBOX_PROFILE_ID,
        appId: DEFAULT_APP_ID,
        name: 'Local development',
        filesystem: 'workspace',
        network: 'enabled',
        process: 'host',
        browser: 'allowed',
        credentialAccess: 'brokered',
        timeoutMs: 300000,
      })
      .onConflictDoNothing();

    const configVersionId = `config:${DEFAULT_AGENT_ID}:1`;
    await tx
      .insert(pgSchema.agentsPostgres)
      .values({
        id: DEFAULT_AGENT_ID,
        appId: DEFAULT_APP_ID,
        name: 'Personal Agent',
        currentConfigVersionId: configVersionId,
      })
      .onConflictDoUpdate({
        target: pgSchema.agentsPostgres.id,
        set: { currentConfigVersionId: configVersionId, updatedAt: sql`now()` },
      });

    await tx
      .insert(pgSchema.agentConfigVersionsPostgres)
      .values({
        id: configVersionId,
        appId: DEFAULT_APP_ID,
        agentId: DEFAULT_AGENT_ID,
        version: 1,
        promptProfileRef: 'default',
        llmProfileId: DEFAULT_LLM_PROFILE_ID,
        sandboxProfileId: DEFAULT_SANDBOX_PROFILE_ID,
        permissionPolicyIdsJson: JSON.stringify([DEFAULT_PERMISSION_POLICY_ID]),
      })
      .onConflictDoNothing();

    await tx
      .insert(pgSchema.permissionPoliciesPostgres)
      .values({
        id: DEFAULT_PERMISSION_POLICY_ID,
        appId: DEFAULT_APP_ID,
        name: 'Default personal policy',
        description: 'Default local development policy seeded by MyClaw.',
      })
      .onConflictDoNothing();

    await tx
      .insert(pgSchema.permissionRulesPostgres)
      .values({
        id: 'permission-rule:default:approval-required',
        appId: DEFAULT_APP_ID,
        policyId: DEFAULT_PERMISSION_POLICY_ID,
        priority: 100,
        effect: 'require_approval',
        matchJson: JSON.stringify({ risk: ['write', 'execute', 'network'] }),
      })
      .onConflictDoNothing();

    for (const tool of [
      { id: 'tool:memory', name: 'memory', risk: 'low' },
      { id: 'tool:messaging', name: 'messaging', risk: 'medium' },
      { id: 'tool:browser', name: 'browser', risk: 'medium' },
      { id: 'tool:shell', name: 'shell', risk: 'high' },
    ]) {
      await tx
        .insert(pgSchema.toolCatalogPostgres)
        .values({
          id: tool.id,
          appId: DEFAULT_APP_ID,
          name: tool.name,
          risk: tool.risk,
          permissionPolicyId: DEFAULT_PERMISSION_POLICY_ID,
          sandboxProfileId: DEFAULT_SANDBOX_PROFILE_ID,
          adapterRef: `builtin:${tool.name}`,
        })
        .onConflictDoNothing();
    }
  });
}

export async function seedBundledSkills(input: {
  db: NodePgDatabase<typeof pgSchema>;
  artifactRoot: string;
  packageRoot: string;
}): Promise<void> {
  const skillsRoot = path.join(input.packageRoot, '.claude', 'skills');
  if (!fs.existsSync(skillsRoot)) return;
  const store = new LocalSkillAssetStore(input.artifactRoot);
  const entries = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));

  for (const entry of entries) {
    const sourceDir = path.join(skillsRoot, entry.name);
    const files = listSkillFiles(sourceDir);
    if (!files.includes('SKILL.md')) continue;
    const timestamp = new Date().toISOString();
    const skillId = `skill:${DEFAULT_APP_ID}:${entry.name}`;
    const contentHash = aggregateSkillHash(sourceDir, files);
    const versionId = `${skillId}:version:${contentHash.slice('sha256:'.length, 'sha256:'.length + 16)}`;

    await input.db
      .insert(pgSchema.skillCatalogPostgres)
      .values({
        id: skillId,
        appId: DEFAULT_APP_ID,
        name: entry.name,
        source: 'bundled',
        status: 'active',
        version: 'registry',
      })
      .onConflictDoUpdate({
        target: pgSchema.skillCatalogPostgres.id,
        set: {
          source: 'bundled',
          status: 'active',
          updatedAt: sql`now()`,
        },
      });

    await input.db
      .insert(pgSchema.skillVersionsPostgres)
      .values({
        id: versionId,
        skillId,
        version: contentHash.slice('sha256:'.length, 'sha256:'.length + 12),
        entrypoint: 'SKILL.md',
        manifestJson: '{}',
        contentHash,
        approvalStatus: 'approved',
        createdBy: 'system:bundled-seed',
        createdAt: timestamp,
      })
      .onConflictDoNothing();

    for (const relativePath of files) {
      const content = fs.readFileSync(path.join(sourceDir, relativePath));
      const stored = await store.putAsset({
        skillId,
        skillVersionId: versionId,
        path: relativePath,
        content,
      });
      await input.db
        .insert(pgSchema.skillAssetsPostgres)
        .values({
          id: `skill-asset:${versionId}:${relativePath}`,
          skillVersionId: versionId,
          path: relativePath,
          contentType:
            relativePath.endsWith('.md') || relativePath.endsWith('.txt')
              ? 'text/plain'
              : 'application/octet-stream',
          storageType: stored.storageType,
          storageRef: stored.storageRef,
          contentHash: stored.contentHash,
          sizeBytes: stored.sizeBytes,
        })
        .onConflictDoNothing();
    }

    await input.db
      .insert(pgSchema.agentSkillBindingsPostgres)
      .values({
        id: `agent-skill-binding:${DEFAULT_AGENT_ID}:${skillId}`,
        appId: DEFAULT_APP_ID,
        agentId: DEFAULT_AGENT_ID,
        skillId,
        skillVersionId: versionId,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [
          pgSchema.agentSkillBindingsPostgres.agentId,
          pgSchema.agentSkillBindingsPostgres.skillId,
        ],
        set: {
          skillVersionId: versionId,
          status: 'active',
          updatedAt: sql`now()`,
        },
      });
  }
}

function listSkillFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, childPrefix);
      } else if (entry.isFile()) {
        files.push(childPrefix);
      }
    }
  };
  visit(root);
  return files.sort();
}

function aggregateSkillHash(root: string, files: string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}
