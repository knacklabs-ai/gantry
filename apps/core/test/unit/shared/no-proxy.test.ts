import { describe, expect, it } from 'vitest';

import {
  applyAgentEgressNoProxyEnv,
  mergeAgentEgressNoProxy,
} from '@core/shared/no-proxy.js';

describe('agent egress no-proxy policy', () => {
  it('preserves user entries and adds loopback and GitHub defaults once', () => {
    const merged = mergeAgentEgressNoProxy(
      'internal.example, github.com,LOCALHOST',
    );

    expect(merged.split(',')).toEqual([
      'internal.example',
      'github.com',
      'LOCALHOST',
      '127.0.0.1',
      '::1',
      '.github.com',
      'api.github.com',
      'raw.githubusercontent.com',
      'objects.githubusercontent.com',
      'codeload.github.com',
    ]);
  });

  it('writes both uppercase and lowercase env keys from the same merged value', () => {
    const env: Record<string, string | undefined> = {
      NO_PROXY: 'api.internal',
      no_proxy: 'registry.internal',
    };

    applyAgentEgressNoProxyEnv(env);

    expect(env.NO_PROXY).toBe(env.no_proxy);
    expect(env.NO_PROXY?.split(',')).toEqual(
      expect.arrayContaining([
        'api.internal',
        'registry.internal',
        '127.0.0.1',
        'localhost',
        '::1',
        'github.com',
        '.github.com',
        'api.github.com',
        'raw.githubusercontent.com',
        'objects.githubusercontent.com',
        'codeload.github.com',
      ]),
    );
  });
});
