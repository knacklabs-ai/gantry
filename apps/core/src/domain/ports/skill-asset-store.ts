import type { SkillAssetStorageType } from '../skills/skills.js';

export interface PutSkillAssetInput {
  skillId: string;
  skillVersionId: string;
  path: string;
  content: Uint8Array;
}

export interface StoredSkillAsset {
  storageType: SkillAssetStorageType;
  storageRef: string;
  contentHash: string;
  sizeBytes: number;
}

export interface SkillAssetStore {
  putAsset(input: PutSkillAssetInput): Promise<StoredSkillAsset>;
  getAsset(storageRef: string): Promise<Uint8Array>;
}
