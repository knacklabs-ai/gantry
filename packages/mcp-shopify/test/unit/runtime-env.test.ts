import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRuntimeEnv } from '../../src/dotenv-load.js';

// Keys this suite writes into process.env; cleaned up after each test so the
// no-overwrite assertions stay deterministic.
const TOUCHED = ['RTEST_FOO', 'RTEST_BAR', 'RTEST_PRESET'];

function makeHome(envContents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-home-'));
  fs.writeFileSync(path.join(dir, '.env'), envContents);
  return dir;
}

afterEach(() => {
  for (const key of TOUCHED) delete process.env[key];
});

describe('loadRuntimeEnv', () => {
  it('loads <home>/.env into process.env (mirrors core runtime-env read)', () => {
    const home = makeHome('RTEST_FOO=foo\nRTEST_BAR="bar"\n# a comment\n\n');
    const applied = loadRuntimeEnv(home);
    expect(applied).toBe(path.join(home, '.env'));
    expect(process.env.RTEST_FOO).toBe('foo');
    expect(process.env.RTEST_BAR).toBe('bar'); // surrounding quotes stripped
  });

  it('does not overwrite already-set process.env keys', () => {
    process.env.RTEST_PRESET = 'original';
    const home = makeHome('RTEST_PRESET=fromfile\n');
    loadRuntimeEnv(home);
    expect(process.env.RTEST_PRESET).toBe('original');
  });

  it('returns null when <home>/.env is absent', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-empty-'));
    expect(loadRuntimeEnv(empty)).toBeNull();
  });

  it('resolves $GANTRY_HOME when no override is given', () => {
    const home = makeHome('RTEST_FOO=viahome\n');
    const prev = process.env.GANTRY_HOME;
    process.env.GANTRY_HOME = home;
    try {
      loadRuntimeEnv();
      expect(process.env.RTEST_FOO).toBe('viahome');
    } finally {
      if (prev === undefined) delete process.env.GANTRY_HOME;
      else process.env.GANTRY_HOME = prev;
    }
  });
});
