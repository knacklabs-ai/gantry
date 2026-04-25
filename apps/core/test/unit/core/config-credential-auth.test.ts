import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveClaudeAuthState', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not treat model-only external mode as broker auth', async () => {
    vi.stubEnv('MYCLAW_CREDENTIAL_MODE', 'external');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    vi.stubEnv('ONECLI_URL', '');
    vi.resetModules();

    const { resolveClaudeAuthState } = await import('@core/config/index.js');

    expect(resolveClaudeAuthState().mode).toBe('none');
  });

  it('treats external mode as broker auth when a broker endpoint exists', async () => {
    vi.stubEnv('MYCLAW_CREDENTIAL_MODE', 'external');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://broker.local/anthropic');
    vi.stubEnv('ONECLI_URL', '');
    vi.resetModules();

    const { resolveClaudeAuthState } = await import('@core/config/index.js');

    expect(resolveClaudeAuthState().mode).toBe('broker');
  });
});
