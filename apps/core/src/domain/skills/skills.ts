import type { AppId } from '../app/app.js';
import type { AgentId } from '../agent/agent.js';
import type { ToolId } from '../tools/tools.js';
import type { BrandedId } from '../../shared/ids/branded-id.js';
import type { IsoTimestamp } from '../../shared/time/primitives.js';

export type SkillId = BrandedId<'SkillId'>;
export type SkillVersionId = BrandedId<'SkillVersionId'>;
export type SkillAssetId = BrandedId<'SkillAssetId'>;
export type AgentSkillBindingId = BrandedId<'AgentSkillBindingId'>;
export type SkillRegistryEventId = BrandedId<'SkillRegistryEventId'>;

export type SkillSource =
  | 'bundled'
  | 'admin_uploaded'
  | 'marketplace'
  | 'system';
export type SkillStatus = 'active' | 'disabled' | 'deprecated';
export type SkillApprovalStatus = 'draft' | 'approved' | 'rejected';
export type SkillAssetStorageType = 'local-filesystem' | 'object-store';
export type AgentSkillBindingStatus = 'active' | 'disabled';

export interface SkillCatalogItem {
  id: SkillId;
  appId: AppId;
  name: string;
  description?: string;
  source: SkillSource;
  status: SkillStatus;
  version: string;
  promptRefs: string[];
  toolIds: ToolId[];
  workflowRefs: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SkillVersion {
  id: SkillVersionId;
  skillId: SkillId;
  version: string;
  entrypoint: string;
  manifestJson: string;
  contentHash: string;
  approvalStatus: SkillApprovalStatus;
  createdBy: string;
  createdAt: IsoTimestamp;
}

export interface SkillAsset {
  id: SkillAssetId;
  skillVersionId: SkillVersionId;
  path: string;
  contentType: string;
  storageType: SkillAssetStorageType;
  storageRef: string;
  contentHash: string;
  sizeBytes: number;
}

export interface AgentSkillBinding {
  id: AgentSkillBindingId;
  appId: AppId;
  agentId: AgentId;
  skillId: SkillId;
  skillVersionId?: SkillVersionId;
  status: AgentSkillBindingStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ResolvedAgentSkillVersion {
  skill: SkillCatalogItem;
  version: SkillVersion;
  assets: SkillAsset[];
}

export interface SkillRegistryEvent {
  id: SkillRegistryEventId;
  appId: AppId;
  eventType:
    | 'skill.created'
    | 'skill.version.created'
    | 'skill.version.approved'
    | 'skill.version.rejected'
    | 'agent.skill.enabled'
    | 'agent.skill.disabled';
  skillId?: SkillId;
  skillVersionId?: SkillVersionId;
  agentId?: AgentId;
  actorRef?: string;
  payload?: Record<string, unknown>;
  createdAt: IsoTimestamp;
}
