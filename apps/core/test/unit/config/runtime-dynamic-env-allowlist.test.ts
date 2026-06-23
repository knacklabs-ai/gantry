import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(
  new URL('../../../../..', import.meta.url).pathname,
);
const appIndexPath = path.join(repoRoot, 'apps/core/src/app/index.ts');

describe('runtime dynamic env hydration allowlist', () => {
  it('includes core flags read directly from process.env in lower layers', () => {
    const source = fs.readFileSync(appIndexPath, 'utf8');
    const match = /hydrateDynamicRuntimeEnv\(\[([\s\S]*?)\]\);/.exec(source);
    expect(match?.[1]).toBeDefined();
    const allowlistSource = match?.[1] ?? '';
    for (const key of [
      'GANTRY_CHILD_RUNNER_FROM_SOURCE',
      'GANTRY_CHILD_RUNNER_INSPECT_PORT',
      'GANTRY_TRACE_PAYLOADS',
      'GANTRY_SEND_LLM_PROGRESS_MESSAGES',
    ]) {
      expect(allowlistSource).toContain(`'${key}'`);
    }
  });
});
