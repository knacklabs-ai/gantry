import { afterEach, describe, expect, it, vi } from 'vitest';

const originalSecretEncryptionKey = process.env.SECRET_ENCRYPTION_KEY;
const originalSecretEncryptionKeyring =
  process.env.SECRET_ENCRYPTION_KEYRING_JSON;

afterEach(() => {
  if (originalSecretEncryptionKey === undefined) {
    delete process.env.SECRET_ENCRYPTION_KEY;
  } else {
    process.env.SECRET_ENCRYPTION_KEY = originalSecretEncryptionKey;
  }
  if (originalSecretEncryptionKeyring === undefined) {
    delete process.env.SECRET_ENCRYPTION_KEYRING_JSON;
  } else {
    process.env.SECRET_ENCRYPTION_KEYRING_JSON =
      originalSecretEncryptionKeyring;
  }
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@clack/prompts');
  vi.doUnmock('@core/cli/credentials.js');
});

describe('runtime secret ref prompt', () => {
  it('stores Gantry secrets only when the Gantry source is selected', async () => {
    enableGantrySecretStorage();
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

  it('does not default to Gantry storage when encryption is not configured', async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.SECRET_ENCRYPTION_KEYRING_JSON;
    const storeRuntimeSecretInput = vi.fn(async () => undefined);
    const select = vi.fn(async () => 'env');
    const text = vi.fn(async () => 'SLACK_BOT_TOKEN');
    vi.doMock('@core/cli/credentials.js', () => ({ storeRuntimeSecretInput }));
    vi.doMock('@clack/prompts', () => ({
      select,
      text,
      isCancel: vi.fn(() => false),
    }));

    const { planRuntimeSecretInput } =
      await import('@core/cli/runtime-secret-ref-prompt.js');
    const plan = await planRuntimeSecretInput({
      runtimeHome: '/tmp/gantry-secret-ref-test-no-encryption',
      name: 'SLACK_BOT_TOKEN',
      value: 'xoxb-token',
      actor: 'test',
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: 'env',
        options: expect.not.arrayContaining([
          expect.objectContaining({ value: 'gantry' }),
        ]),
      }),
    );
    expect(plan?.ref).toBe('env:SLACK_BOT_TOKEN');
    await plan?.persist();
    expect(storeRuntimeSecretInput).not.toHaveBeenCalled();
  });
});

function enableGantrySecretStorage(): void {
  process.env.SECRET_ENCRYPTION_KEY = Buffer.from(
    Array.from({ length: 32 }, (_, index) => index + 1),
  ).toString('base64');
}
