import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalSkillAssetStore } from '@core/adapters/artifacts/skills/local-skill-asset-store.js';
import { NodeSkillRegistryCrypto } from '@core/adapters/artifacts/skills/node-skill-registry-crypto.js';
import {
  RegistryClaudeSkillSource,
  materializeClaudeSkills,
} from '@core/adapters/llm/anthropic-claude-agent/claude-skill-materializer.js';
import { SkillRegistryService } from '@core/application/skills/skill-registry-service.js';
import type { AgentId } from '@core/domain/agent/agent.js';
import type { AppId } from '@core/domain/app/app.js';
import type { SkillCatalogRepository } from '@core/domain/ports/repositories.js';
import type {
  AgentSkillBinding,
  ResolvedAgentSkillVersion,
  SkillAsset,
  SkillCatalogItem,
  SkillRegistryEvent,
  SkillVersion,
} from '@core/domain/skills/skills.js';

const appId = 'default' as AppId;
const agentId = 'agent:test' as AgentId;

class InMemorySkillRepository implements SkillCatalogRepository {
  skills = new Map<string, SkillCatalogItem>();
  versions = new Map<string, SkillVersion>();
  assets = new Map<string, SkillAsset[]>();
  bindings = new Map<string, AgentSkillBinding>();
  events: SkillRegistryEvent[] = [];

  async listSkills(appId: AppId) {
    return [...this.skills.values()].filter((skill) => skill.appId === appId);
  }

  async getSkill(id: SkillCatalogItem['id']) {
    return this.skills.get(id) ?? null;
  }

  async saveSkill(item: SkillCatalogItem) {
    this.skills.set(item.id, item);
  }

  async updateSkill(
    input: Parameters<SkillCatalogRepository['updateSkill']>[0],
  ) {
    const skill = this.skills.get(input.id);
    if (!skill || skill.appId !== input.appId) return null;
    const next = { ...skill, ...input.patch, updatedAt: input.updatedAt };
    this.skills.set(next.id, next);
    return next;
  }

  async saveSkillVersion(version: SkillVersion, assets: SkillAsset[]) {
    if (!this.versions.has(version.id)) {
      this.versions.set(version.id, version);
      this.assets.set(version.id, assets);
    }
  }

  async getSkillVersion(id: SkillVersion['id']) {
    return this.versions.get(id) ?? null;
  }

  async listSkillVersions(skillId: SkillCatalogItem['id']) {
    return [...this.versions.values()].filter(
      (version) => version.skillId === skillId,
    );
  }

  async listSkillAssets(skillVersionId: SkillVersion['id']) {
    return this.assets.get(skillVersionId) ?? [];
  }

  async updateSkillVersionApproval(
    input: Parameters<SkillCatalogRepository['updateSkillVersionApproval']>[0],
  ) {
    const version = this.versions.get(input.versionId);
    if (!version || version.skillId !== input.skillId) return null;
    const next = { ...version, approvalStatus: input.approvalStatus };
    this.versions.set(next.id, next);
    return next;
  }

  async saveAgentSkillBinding(binding: AgentSkillBinding) {
    this.bindings.set(`${binding.agentId}:${binding.skillId}`, binding);
  }

  async getAgentSkillBinding(
    input: Parameters<SkillCatalogRepository['getAgentSkillBinding']>[0],
  ) {
    return this.bindings.get(`${input.agentId}:${input.skillId}`) ?? null;
  }

  async listAgentSkillBindings(
    input: Parameters<SkillCatalogRepository['listAgentSkillBindings']>[0],
  ) {
    return [...this.bindings.values()].filter(
      (binding) =>
        binding.appId === input.appId && binding.agentId === input.agentId,
    );
  }

  async disableAgentSkillBinding(
    input: Parameters<SkillCatalogRepository['disableAgentSkillBinding']>[0],
  ) {
    const binding = this.bindings.get(`${input.agentId}:${input.skillId}`);
    if (!binding || binding.appId !== input.appId) return null;
    const next = {
      ...binding,
      status: 'disabled' as const,
      updatedAt: input.updatedAt,
    };
    this.bindings.set(`${input.agentId}:${input.skillId}`, next);
    return next;
  }

  async resolveEnabledSkillVersionsForAgent(
    input: Parameters<
      SkillCatalogRepository['resolveEnabledSkillVersionsForAgent']
    >[0],
  ) {
    const resolved: ResolvedAgentSkillVersion[] = [];
    for (const binding of await this.listAgentSkillBindings(input)) {
      if (binding.status !== 'active') continue;
      const skill = this.skills.get(binding.skillId);
      if (!skill || skill.status !== 'active') continue;
      const versions = binding.skillVersionId
        ? [this.versions.get(binding.skillVersionId)].filter(
            (version): version is SkillVersion => Boolean(version),
          )
        : await this.listSkillVersions(binding.skillId);
      const version = versions.find(
        (candidate) => candidate.approvalStatus === 'approved',
      );
      if (!version) continue;
      resolved.push({
        skill,
        version,
        assets: this.assets.get(version.id) ?? [],
      });
    }
    return resolved;
  }

  async recordSkillRegistryEvent(event: SkillRegistryEvent) {
    this.events.push(event);
  }
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

describe('SkillRegistryService', () => {
  let tempRoot = '';
  let repository: InMemorySkillRepository;
  let service: SkillRegistryService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myclaw-skills-'));
    repository = new InMemorySkillRepository();
    service = new SkillRegistryService(
      repository,
      new LocalSkillAssetStore(tempRoot),
      new NodeSkillRegistryCrypto(),
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('imports a skill version as draft and keeps approved versions immutable', async () => {
    const skill = await service.createSkill({
      appId,
      name: 'review-helper',
      actorRef: 'admin',
    });
    const created = await service.createSkillVersion({
      appId,
      skillId: skill.id,
      createdBy: 'admin',
      assets: [
        {
          path: 'SKILL.md',
          contentType: 'text/plain',
          content: Buffer.from('# Review helper'),
        },
      ],
    });

    expect(created.version.approvalStatus).toBe('draft');
    await service.approveSkillVersion({
      appId,
      skillId: skill.id,
      versionId: created.version.id,
      actorRef: 'admin',
    });
    await expect(
      service.rejectSkillVersion({
        appId,
        skillId: skill.id,
        versionId: created.version.id,
        actorRef: 'admin',
      }),
    ).rejects.toThrow('immutable');
  });

  it('materializes only approved enabled skills with matching stored hashes', async () => {
    const skill = await service.createSkill({
      appId,
      name: 'approved-skill',
      actorRef: 'admin',
    });
    const approved = await service.createSkillVersion({
      appId,
      skillId: skill.id,
      createdBy: 'admin',
      assets: [
        {
          path: 'SKILL.md',
          contentType: 'text/plain',
          content: Buffer.from('# Approved'),
        },
      ],
    });
    await service.approveSkillVersion({
      appId,
      skillId: skill.id,
      versionId: approved.version.id,
    });
    await service.bindSkillToAgent({
      appId,
      agentId,
      skillId: skill.id,
      skillVersionId: approved.version.id,
    });

    const draftSkill = await service.createSkill({
      appId,
      name: 'draft-skill',
    });
    await service.createSkillVersion({
      appId,
      skillId: draftSkill.id,
      createdBy: 'admin',
      assets: [{ path: 'SKILL.md', content: Buffer.from('# Draft') }],
    });
    await service.bindSkillToAgent({ appId, agentId, skillId: draftSkill.id });

    const disabledSkill = await service.createSkill({
      appId,
      name: 'disabled-skill',
    });
    const disabledVersion = await service.createSkillVersion({
      appId,
      skillId: disabledSkill.id,
      createdBy: 'admin',
      assets: [{ path: 'SKILL.md', content: Buffer.from('# Disabled') }],
    });
    await service.approveSkillVersion({
      appId,
      skillId: disabledSkill.id,
      versionId: disabledVersion.version.id,
    });
    await service.bindSkillToAgent({
      appId,
      agentId,
      skillId: disabledSkill.id,
      skillVersionId: disabledVersion.version.id,
    });
    await service.unbindSkillFromAgent({
      appId,
      agentId,
      skillId: disabledSkill.id,
    });

    const skillsDir = path.join(tempRoot, 'run-skills');
    await materializeClaudeSkills({
      skillsDir,
      skillSource: new RegistryClaudeSkillSource(
        repository,
        new LocalSkillAssetStore(tempRoot),
        { appId, agentId },
      ),
    });

    const materialized = path.join(skillsDir, 'approved-skill', 'SKILL.md');
    expect(fs.existsSync(materialized)).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'draft-skill'))).toBe(false);
    expect(fs.existsSync(path.join(skillsDir, 'disabled-skill'))).toBe(false);
    expect(sha256(fs.readFileSync(materialized, 'utf8'))).toBe(
      approved.assets[0]?.contentHash,
    );
  });

  it('emits audit events when skills are enabled and disabled', async () => {
    const skill = await service.createSkill({ appId, name: 'audit-skill' });
    const created = await service.createSkillVersion({
      appId,
      skillId: skill.id,
      createdBy: 'admin',
      assets: [{ path: 'SKILL.md', content: Buffer.from('# Audit') }],
    });
    await service.approveSkillVersion({
      appId,
      skillId: skill.id,
      versionId: created.version.id,
    });
    await service.bindSkillToAgent({
      appId,
      agentId,
      skillId: skill.id,
      skillVersionId: created.version.id,
    });
    await service.unbindSkillFromAgent({ appId, agentId, skillId: skill.id });

    expect(repository.events.map((event) => event.eventType)).toContain(
      'agent.skill.enabled',
    );
    expect(repository.events.map((event) => event.eventType)).toContain(
      'agent.skill.disabled',
    );
  });
});
