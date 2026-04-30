import { describe, expect, it } from 'vitest';

import { resolveAppScopeAppId } from '@core/application/app-scope/resolve-app-scope.js';

describe('resolveAppScopeAppId', () => {
  it('defaults to api-key app scope when request omits appId', () => {
    expect(
      resolveAppScopeAppId({
        apiKeyAppId: 'app-one',
        assertedAppId: undefined,
      }),
    ).toBe('app-one');
  });

  it('accepts matching asserted appId after trimming', () => {
    expect(
      resolveAppScopeAppId({
        apiKeyAppId: 'app-one',
        assertedAppId: '  app-one  ',
      }),
    ).toBe('app-one');
  });

  it('rejects mismatched asserted appId', () => {
    expect(
      resolveAppScopeAppId({
        apiKeyAppId: 'app-one',
        assertedAppId: 'app-two',
      }),
    ).toBeNull();
  });
});
