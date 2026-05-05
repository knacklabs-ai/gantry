import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getDistRoot,
  getPackageRoot,
  getRuntimeEntryPath,
} from '@core/infrastructure/service/package-paths.js';

function fileUrl(filePath: string): string {
  return new URL(`file://${filePath}`).href;
}

describe('service package paths', () => {
  it('resolves runtime entry beside dist cli for packaged runs', () => {
    const importMetaUrl = fileUrl('/repo/dist/cli/index.js');

    expect(getDistRoot(importMetaUrl)).toBe(path.resolve('/repo/dist'));
    expect(getPackageRoot(importMetaUrl)).toBe(path.resolve('/repo'));
    expect(getRuntimeEntryPath(importMetaUrl)).toBe(
      path.resolve('/repo/dist/index.js'),
    );
  });

  it('resolves source cli runs to the built runtime entry', () => {
    const importMetaUrl = fileUrl('/repo/apps/core/src/cli/index.ts');

    expect(getDistRoot(importMetaUrl)).toBe(path.resolve('/repo/dist'));
    expect(getPackageRoot(importMetaUrl)).toBe(path.resolve('/repo'));
    expect(getRuntimeEntryPath(importMetaUrl)).toBe(
      path.resolve('/repo/dist/index.js'),
    );
  });
});
