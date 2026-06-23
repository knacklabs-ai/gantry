import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('boondi runtime stack script', () => {
  const script = readFileSync(
    path.resolve('scripts/boondi-runtime-stack.sh'),
    'utf8',
  );

  it('checks Gantry core readiness through the unauthenticated liveness route', () => {
    expect(script).toContain('http://127.0.0.1:${core_port}/livez');
    expect(script).not.toContain('-H "Authorization: Bearer ${core_token}"');
    expect(script).not.toContain('"http://127.0.0.1:${core_port}/"');
  });
});
