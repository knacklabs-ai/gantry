import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@clack/prompts');
  vi.doUnmock('@core/cli/credentials.js');
});

describe('runtime secret ref prompt', () => {
  it('stores Gantry secrets only when the Gantry source is selected', async () => {
    const storeRuntimeSecretInput = vi.fn(async () => undefined);
    vi.doMock('@core/cli/credentials.js', () => ({ storeRuntimeSecretInput }));
    vi.doMock('@clack/prompts', () => ({
      select: vi.fn(async () => 'gantry'),
      isCancel: vi.fn(() => false),
    }));

    const { planRuntimeSecretInput } =
      await import('@core/cli/runtime-secret-ref-prompt.js');
    const plan = await planRuntimeSecretInput({
      runtimeHome: '/tmp/gantry-secret-ref-test',
      name: 'SLACK_BOT_TOKEN',
      value: 'xoxb-token',
      actor: 'test',
    });

    expect(plan?.ref).toBe('gantry-secret:SLACK_BOT_TOKEN');
    await plan?.persist();
    expect(storeRuntimeSecretInput).toHaveBeenCalledWith({
      runtimeHome: '/tmp/gantry-secret-ref-test',
      name: 'SLACK_BOT_TOKEN',
      value: 'xoxb-token',
      actor: 'test',
    });
  });

  it('can save env and AWS refs without storing the entered validation secret', async () => {
    const storeRuntimeSecretInput = vi.fn(async () => undefined);
    const text = vi
      .fn()
      .mockResolvedValueOnce('SLACK_TOKEN_FROM_ENV')
      .mockResolvedValueOnce('prod/slack/bot');
    const select = vi
      .fn()
      .mockResolvedValueOnce('env')
      .mockResolvedValueOnce('aws-sm');
    vi.doMock('@core/cli/credentials.js', () => ({ storeRuntimeSecretInput }));
    vi.doMock('@clack/prompts', () => ({
      select,
      text,
      isCancel: vi.fn(() => false),
    }));

    const { planRuntimeSecretInput } =
      await import('@core/cli/runtime-secret-ref-prompt.js');
    const envPlan = await planRuntimeSecretInput({
      runtimeHome: '/tmp/gantry-secret-ref-test',
      name: 'SLACK_BOT_TOKEN',
      value: 'xoxb-token',
      actor: 'test',
    });
    const awsPlan = await planRuntimeSecretInput({
      runtimeHome: '/tmp/gantry-secret-ref-test',
      name: 'SLACK_APP_TOKEN',
      value: 'xapp-token',
      actor: 'test',
    });

    expect(envPlan?.ref).toBe('env:SLACK_TOKEN_FROM_ENV');
    expect(awsPlan?.ref).toBe('aws-sm:prod/slack/bot');
    await envPlan?.persist();
    await awsPlan?.persist();
    expect(storeRuntimeSecretInput).not.toHaveBeenCalled();
  });
});
