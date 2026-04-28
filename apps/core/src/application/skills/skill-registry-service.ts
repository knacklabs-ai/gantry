import type { AgentId } from '../../domain/agent/agent.js';
import type { AppId } from '../../domain/app/app.js';
import type { SkillAssetStore } from '../../domain/ports/skill-asset-store.js';
import type { SkillCatalogRepository } from '../../domain/ports/repositories.js';
import type {
  AgentSkillBinding,
  SkillAsset,
  SkillCatalogItem,
  SkillId,
  SkillVersion,
  SkillVersionId,
} from '../../domain/skills/skills.js';
import { ApplicationError } from '../common/application-error.js';

export interface SkillVersionAssetInput {
  path: string;
  contentType?: string;
  content: Uint8Array;
}

export interface SkillRegistryCrypto {
  randomId(): string;
  sha256(content: Uint8Array | string): string;
  aggregateHash(assets: SkillVersionAssetInput[]): string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function skillIdFor(appId: AppId, name: string): SkillId {
  return `skill:${appId}:${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')}` as SkillId;
}

function versionIdFor(skillId: SkillId, contentHash: string): SkillVersionId {
  return `${skillId}:version:${contentHash.slice('sha256:'.length, 'sha256:'.length + 16)}` as SkillVersionId;
}

export class SkillRegistryService {
  constructor(
    private readonly repository: SkillCatalogRepository,
    private readonly assetStore: SkillAssetStore,
    private readonly crypto: SkillRegistryCrypto,
  ) {}

  listSkills(input: { appId: AppId }): Promise<SkillCatalogItem[]> {
    return this.repository.listSkills(input.appId);
  }

  async getSkill(input: { appId: AppId; skillId: SkillId }) {
    const skill = await this.repository.getSkill(input.skillId);
    if (!skill || skill.appId !== input.appId) {
      throw new ApplicationError('NOT_FOUND', 'Skill not found');
    }
    return skill;
  }

  async createSkill(input: {
    appId: AppId;
    name: string;
    description?: string;
    source?: SkillCatalogItem['source'];
    actorRef?: string;
  }): Promise<SkillCatalogItem> {
    const timestamp = nowIso();
    const skill: SkillCatalogItem = {
      id: skillIdFor(input.appId, input.name),
      appId: input.appId,
      name: input.name,
      description: input.description,
      source: input.source ?? 'admin_uploaded',
      status: 'active',
      version: 'registry',
      promptRefs: [],
      toolIds: [],
      workflowRefs: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveSkill(skill);
    await this.repository.recordSkillRegistryEvent({
      id: `skill-event:${this.crypto.randomId()}` as never,
      appId: input.appId,
      eventType: 'skill.created',
      skillId: skill.id,
      actorRef: input.actorRef,
      createdAt: timestamp,
    });
    return skill;
  }

  async updateSkill(input: {
    appId: AppId;
    skillId: SkillId;
    patch: Partial<Pick<SkillCatalogItem, 'name' | 'description' | 'status'>>;
  }): Promise<SkillCatalogItem> {
    const skill = await this.repository.updateSkill({
      appId: input.appId,
      id: input.skillId,
      patch: input.patch,
      updatedAt: nowIso(),
    });
    if (!skill) throw new ApplicationError('NOT_FOUND', 'Skill not found');
    return skill;
  }

  async createSkillVersion(input: {
    appId: AppId;
    skillId: SkillId;
    version?: string;
    entrypoint?: string;
    manifestJson?: string;
    createdBy: string;
    approvalStatus?: SkillVersion['approvalStatus'];
    assets: SkillVersionAssetInput[];
  }): Promise<{ version: SkillVersion; assets: SkillAsset[] }> {
    const skill = await this.getSkill({
      appId: input.appId,
      skillId: input.skillId,
    });
    if (input.assets.length === 0) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Skill version requires at least one asset',
      );
    }
    if (
      !input.assets.some(
        (asset) => asset.path === (input.entrypoint ?? 'SKILL.md'),
      )
    ) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Skill version must include its entrypoint',
      );
    }
    const timestamp = nowIso();
    const contentHash = this.crypto.aggregateHash(input.assets);
    const version: SkillVersion = {
      id: versionIdFor(skill.id, contentHash),
      skillId: skill.id,
      version:
        input.version ??
        contentHash.slice('sha256:'.length, 'sha256:'.length + 12),
      entrypoint: input.entrypoint ?? 'SKILL.md',
      manifestJson: input.manifestJson ?? '{}',
      contentHash,
      approvalStatus: input.approvalStatus ?? 'draft',
      createdBy: input.createdBy,
      createdAt: timestamp,
    };
    const assets: SkillAsset[] = [];
    for (const assetInput of input.assets) {
      const stored = await this.assetStore.putAsset({
        skillId: skill.id,
        skillVersionId: version.id,
        path: assetInput.path,
        content: assetInput.content,
      });
      const asset: SkillAsset = {
        id: `skill-asset:${this.crypto.randomId()}` as never,
        skillVersionId: version.id,
        path: assetInput.path,
        contentType: assetInput.contentType ?? 'application/octet-stream',
        storageType: stored.storageType,
        storageRef: stored.storageRef,
        contentHash: stored.contentHash,
        sizeBytes: stored.sizeBytes,
      };
      if (asset.contentHash !== this.crypto.sha256(assetInput.content)) {
        throw new ApplicationError(
          'CONFLICT',
          'Stored skill asset hash mismatch',
        );
      }
      assets.push(asset);
    }
    await this.repository.saveSkillVersion(version, assets);
    await this.repository.recordSkillRegistryEvent({
      id: `skill-event:${this.crypto.randomId()}` as never,
      appId: input.appId,
      eventType: 'skill.version.created',
      skillId: skill.id,
      skillVersionId: version.id,
      actorRef: input.createdBy,
      payload: { contentHash },
      createdAt: timestamp,
    });
    return { version, assets };
  }

  async approveSkillVersion(input: {
    appId: AppId;
    skillId: SkillId;
    versionId: SkillVersionId;
    actorRef?: string;
  }): Promise<SkillVersion> {
    return this.setApproval({ ...input, approvalStatus: 'approved' });
  }

  async rejectSkillVersion(input: {
    appId: AppId;
    skillId: SkillId;
    versionId: SkillVersionId;
    actorRef?: string;
  }): Promise<SkillVersion> {
    return this.setApproval({ ...input, approvalStatus: 'rejected' });
  }

  private async setApproval(input: {
    appId: AppId;
    skillId: SkillId;
    versionId: SkillVersionId;
    approvalStatus: SkillVersion['approvalStatus'];
    actorRef?: string;
  }): Promise<SkillVersion> {
    await this.getSkill({ appId: input.appId, skillId: input.skillId });
    const existing = await this.repository.getSkillVersion(input.versionId);
    if (!existing || existing.skillId !== input.skillId) {
      throw new ApplicationError('NOT_FOUND', 'Skill version not found');
    }
    if (existing.approvalStatus === 'approved') {
      throw new ApplicationError(
        'CONFLICT',
        'Approved skill versions are immutable',
      );
    }
    const updated = await this.repository.updateSkillVersionApproval(input);
    if (!updated)
      throw new ApplicationError('NOT_FOUND', 'Skill version not found');
    await this.repository.recordSkillRegistryEvent({
      id: `skill-event:${this.crypto.randomId()}` as never,
      appId: input.appId,
      eventType:
        input.approvalStatus === 'approved'
          ? 'skill.version.approved'
          : 'skill.version.rejected',
      skillId: input.skillId,
      skillVersionId: input.versionId,
      actorRef: input.actorRef,
      createdAt: nowIso(),
    });
    return updated;
  }

  async bindSkillToAgent(input: {
    appId: AppId;
    agentId: AgentId;
    skillId: SkillId;
    skillVersionId?: SkillVersionId;
    actorRef?: string;
  }): Promise<AgentSkillBinding> {
    await this.getSkill({ appId: input.appId, skillId: input.skillId });
    if (input.skillVersionId) {
      const version = await this.repository.getSkillVersion(
        input.skillVersionId,
      );
      if (
        !version ||
        version.skillId !== input.skillId ||
        version.approvalStatus !== 'approved'
      ) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Agent skill binding requires an approved skill version',
        );
      }
    }
    const timestamp = nowIso();
    const existing = await this.repository.getAgentSkillBinding(input);
    const binding: AgentSkillBinding = {
      id:
        existing?.id ??
        (`agent-skill-binding:${this.crypto.randomId()}` as never),
      appId: input.appId,
      agentId: input.agentId,
      skillId: input.skillId,
      skillVersionId: input.skillVersionId,
      status: 'active',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveAgentSkillBinding(binding);
    await this.repository.recordSkillRegistryEvent({
      id: `skill-event:${this.crypto.randomId()}` as never,
      appId: input.appId,
      eventType: 'agent.skill.enabled',
      skillId: input.skillId,
      skillVersionId: input.skillVersionId,
      agentId: input.agentId,
      actorRef: input.actorRef,
      createdAt: timestamp,
    });
    return binding;
  }

  async unbindSkillFromAgent(input: {
    appId: AppId;
    agentId: AgentId;
    skillId: SkillId;
    actorRef?: string;
  }): Promise<AgentSkillBinding | null> {
    const timestamp = nowIso();
    const binding = await this.repository.disableAgentSkillBinding({
      ...input,
      updatedAt: timestamp,
    });
    await this.repository.recordSkillRegistryEvent({
      id: `skill-event:${this.crypto.randomId()}` as never,
      appId: input.appId,
      eventType: 'agent.skill.disabled',
      skillId: input.skillId,
      agentId: input.agentId,
      actorRef: input.actorRef,
      createdAt: timestamp,
    });
    return binding;
  }

  listAgentSkills(input: { appId: AppId; agentId: AgentId }) {
    return this.repository.listAgentSkillBindings(input);
  }

  resolveEnabledSkillVersionsForAgent(input: {
    appId: AppId;
    agentId: AgentId;
  }) {
    return this.repository.resolveEnabledSkillVersionsForAgent(input);
  }
}
