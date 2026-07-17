import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../..');
const OPS_ROOT = resolve(REPOSITORY_ROOT, 'ops');
const FORBIDDEN_VARIABLES = [
  'GANTRY_UI_LOCAL_OWNER_ENABLED',
  'GANTRY_UI_LOCAL_OWNER_KEY_ID',
] as const;

describe('local-owner UI deployment boundary', () => {
  it('does not wire local-owner variables into deployment definitions', async () => {
    const files = await listFiles(OPS_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const variable of FORBIDDEN_VARIABLES) {
        if (content.includes(variable)) {
          violations.push(
            `${file.slice(REPOSITORY_ROOT.length + 1)}: ${variable}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path]);
    }),
  );
  return files.flat();
}
