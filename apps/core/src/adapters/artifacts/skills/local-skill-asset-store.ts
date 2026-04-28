import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  PutSkillAssetInput,
  SkillAssetStore,
  StoredSkillAsset,
} from '../../../domain/ports/skill-asset-store.js';

function sanitizeSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._:-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 160) || 'value'
  );
}

function normalizeAssetPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid skill asset path: ${value}`);
  }
  return normalized;
}

function ensureWithinBase(base: string, candidate: string): void {
  const relative = path.relative(base, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Skill artifact path escapes artifact root');
  }
}

export class LocalSkillAssetStore implements SkillAssetStore {
  constructor(private readonly artifactRoot: string) {}

  async putAsset(input: PutSkillAssetInput): Promise<StoredSkillAsset> {
    const safePath = normalizeAssetPath(input.path);
    const content = Buffer.from(input.content);
    const contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    const storageRef = path.posix.join(
      'skills',
      sanitizeSegment(input.skillId),
      sanitizeSegment(input.skillVersionId),
      safePath,
    );
    const target = path.join(this.artifactRoot, storageRef);
    ensureWithinBase(this.artifactRoot, target);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, content, { mode: 0o600 });
    return {
      storageType: 'local-filesystem',
      storageRef,
      contentHash,
      sizeBytes: content.byteLength,
    };
  }

  async getAsset(storageRef: string): Promise<Uint8Array> {
    const target = path.join(this.artifactRoot, storageRef);
    ensureWithinBase(this.artifactRoot, target);
    return fs.readFileSync(target);
  }
}
