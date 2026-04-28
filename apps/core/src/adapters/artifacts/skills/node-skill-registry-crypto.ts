import { createHash, randomUUID } from 'node:crypto';

import type {
  SkillRegistryCrypto,
  SkillVersionAssetInput,
} from '../../../application/skills/skill-registry-service.js';

export class NodeSkillRegistryCrypto implements SkillRegistryCrypto {
  randomId(): string {
    return randomUUID();
  }

  sha256(content: Uint8Array | string): string {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  }

  aggregateHash(assets: SkillVersionAssetInput[]): string {
    const hash = createHash('sha256');
    for (const asset of [...assets].sort((a, b) =>
      a.path.localeCompare(b.path),
    )) {
      hash.update(asset.path);
      hash.update('\0');
      hash.update(Buffer.from(asset.content));
      hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
  }
}
