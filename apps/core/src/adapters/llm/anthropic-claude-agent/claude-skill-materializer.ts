import fs from 'fs';
import path from 'path';

import type { AgentId } from '../../../domain/agent/agent.js';
import type { AppId } from '../../../domain/app/app.js';
import type { SkillAssetStore } from '../../../domain/ports/skill-asset-store.js';
import type { SkillCatalogRepository } from '../../../domain/ports/repositories.js';

export interface ClaudeSkillSourceItem {
  id: string;
  name: string;
  sourceDir?: string;
  assets?: Array<{
    path: string;
    content: Uint8Array;
    contentHash: string;
  }>;
  enabled: boolean;
}

export interface SkillSource {
  listSkills(input?: {
    enabledSkillIds?: string[];
  }): Promise<ClaudeSkillSourceItem[]>;
}

export class BundledClaudeSkillSource implements SkillSource {
  constructor(private readonly packageRoot: string) {}

  async listSkills(input?: {
    enabledSkillIds?: string[];
  }): Promise<ClaudeSkillSourceItem[]> {
    const skillsRoot = path.join(this.packageRoot, '.claude', 'skills');
    if (!fs.existsSync(skillsRoot)) return [];
    const enabled = input?.enabledSkillIds
      ? new Set(input.enabledSkillIds)
      : undefined;

    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const sourceDir = path.join(skillsRoot, entry.name);
        return {
          id: entry.name,
          name: entry.name,
          sourceDir,
          enabled: !enabled || enabled.has(entry.name),
        };
      });
  }
}

export class RegistryClaudeSkillSource implements SkillSource {
  constructor(
    private readonly repository: SkillCatalogRepository,
    private readonly assetStore: SkillAssetStore,
    private readonly context: { appId: AppId; agentId: AgentId },
  ) {}

  async listSkills(input?: {
    enabledSkillIds?: string[];
  }): Promise<ClaudeSkillSourceItem[]> {
    const enabled = input?.enabledSkillIds
      ? new Set(input.enabledSkillIds)
      : undefined;
    const resolved = await this.repository.resolveEnabledSkillVersionsForAgent(
      this.context,
    );
    const skills: ClaudeSkillSourceItem[] = [];
    for (const item of resolved) {
      const id = item.skill.id;
      if (enabled && !enabled.has(id) && !enabled.has(item.skill.name)) {
        continue;
      }
      const assets = [];
      for (const asset of item.assets) {
        assets.push({
          path: asset.path,
          content: await this.assetStore.getAsset(asset.storageRef),
          contentHash: asset.contentHash,
        });
      }
      skills.push({
        id,
        name: item.skill.name,
        assets,
        enabled: true,
      });
    }
    return skills;
  }
}

export async function materializeClaudeSkills(input: {
  skillSource: SkillSource;
  skillsDir: string;
  enabledSkillIds?: string[];
}): Promise<ClaudeSkillSourceItem[]> {
  const skills = await input.skillSource.listSkills({
    enabledSkillIds: input.enabledSkillIds,
  });
  fs.mkdirSync(input.skillsDir, { recursive: true, mode: 0o700 });

  const materialized: ClaudeSkillSourceItem[] = [];
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const targetDir = path.join(input.skillsDir, sanitizeSkillName(skill.name));
    if (skill.assets) {
      if (!skill.assets.some((asset) => asset.path === 'SKILL.md')) continue;
      writeAssets(skill.assets, targetDir);
    } else if (skill.sourceDir) {
      const sourceDir = path.resolve(skill.sourceDir);
      const skillFile = path.join(sourceDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      copyDirRecursive(sourceDir, targetDir);
    } else {
      continue;
    }
    materialized.push(skill);
  }
  return materialized;
}

function sanitizeSkillName(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return safe || 'skill';
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function writeAssets(
  assets: NonNullable<ClaudeSkillSourceItem['assets']>,
  targetDir: string,
): void {
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  for (const asset of assets) {
    const normalized = path.posix.normalize(asset.path.replace(/\\/g, '/'));
    if (
      !normalized ||
      normalized === '.' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      path.posix.isAbsolute(normalized)
    ) {
      continue;
    }
    const target = path.join(targetDir, normalized);
    const relative = path.relative(targetDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, Buffer.from(asset.content), { mode: 0o600 });
  }
}
