import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readAgentRuntimeFile } from '@core/platform/agent-content.js';

// AGENTS_DIR resolves to <GANTRY_HOME>/agents; the test setup points GANTRY_HOME
// at a temp runtime home (see test/setup/runtime-env.ts), so we write fixtures
// directly under it.
const AGENTS_DIR = path.join(process.env.GANTRY_HOME as string, 'agents');
const FOLDER = 'agent_content_test';
const FOLDER_DIR = path.join(AGENTS_DIR, FOLDER);

afterEach(() => {
  fs.rmSync(FOLDER_DIR, { recursive: true, force: true });
});

describe('readAgentRuntimeFile', () => {
  it('returns the trimmed contents of an existing file', () => {
    fs.mkdirSync(FOLDER_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(FOLDER_DIR, 'PROMPT.md'),
      '\n  hello from the agent folder  \n',
      'utf8',
    );
    expect(readAgentRuntimeFile(FOLDER, 'PROMPT.md')).toBe(
      'hello from the agent folder',
    );
  });

  it('returns null when the file does not exist', () => {
    fs.mkdirSync(FOLDER_DIR, { recursive: true });
    expect(readAgentRuntimeFile(FOLDER, 'MISSING.md')).toBeNull();
  });

  it('returns null for a blank/whitespace-only file (caller falls back to default)', () => {
    fs.mkdirSync(FOLDER_DIR, { recursive: true });
    fs.writeFileSync(path.join(FOLDER_DIR, 'BLANK.md'), '   \n\t\n', 'utf8');
    expect(readAgentRuntimeFile(FOLDER, 'BLANK.md')).toBeNull();
  });

  it('returns null for an invalid/unsafe folder name instead of throwing', () => {
    expect(readAgentRuntimeFile('../escape', 'PROMPT.md')).toBeNull();
  });
});
