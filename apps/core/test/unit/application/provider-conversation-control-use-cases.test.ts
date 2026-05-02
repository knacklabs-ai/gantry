import { describe, expect, it, vi } from 'vitest';

import { ProviderConnectionControlService } from '@core/application/provider-conversations/provider-conversation-control-use-cases.js';

const iso = '2026-05-02T00:00:00.000Z';

describe('ProviderConnectionControlService', () => {
  it('preserves null external refs when updating provider connections', async () => {
    const providerConnection = {
      id: 'providerConnection-1',
      appId: 'default',
      providerId: 'telegram',
      externalInstallationRef: {
        kind: 'provider_connection',
        value: 'stale-ref',
      },
      label: 'Telegram',
      status: 'active',
      config: {},
      runtimeSecretRefs: ['TELEGRAM_BOT_TOKEN'],
      createdAt: iso,
      updatedAt: iso,
    };
    const providerConnections = {
      getProviderConnection: vi.fn(async () => providerConnection),
      updateProviderConnection: vi.fn(async () => ({
        ...providerConnection,
        externalInstallationRef: undefined,
      })),
    };
    const service = new ProviderConnectionControlService({
      providerConnections: providerConnections as never,
      providers: { listProviders: vi.fn(async () => []) },
      ids: { generate: vi.fn(() => 'id-1') },
      clock: { now: () => iso },
    });

    await service.update({
      appId: 'default' as never,
      providerConnectionId: 'providerConnection-1' as never,
      patch: { externalInstallationRef: null },
    });

    expect(providerConnections.updateProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ externalInstallationRef: null }),
      }),
    );
  });
});
