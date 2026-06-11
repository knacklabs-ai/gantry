import { describe, expect, it, vi } from 'vitest';

import {
  LIVE_TURN_HOST_LEASE_KEY,
  acquireLiveTurnHostLease,
  routeScopeActiveLiveTurnAdmission,
} from '@core/app/bootstrap/live-turn-host.js';
import { createDefaultRuntimeSettings } from '@core/config/settings/runtime-settings.js';

describe('live-turn host lease', () => {
  it('skips the host lease when live turns are disabled', async () => {
    const runtimeSettings = createDefaultRuntimeSettings();
    runtimeSettings.runtime.liveTurns.enabled = false;
    const tryAcquire = vi.fn();

    const lease = await acquireLiveTurnHostLease({
      runtimeSettings,
      leases: { tryAcquire },
    });

    expect(lease).toBeUndefined();
    expect(tryAcquire).not.toHaveBeenCalled();
  });

  it('acquires the single live-turn host lease by default', async () => {
    const runtimeSettings = createDefaultRuntimeSettings();
    const lease = { release: vi.fn() };
    const tryAcquire = vi.fn(async () => lease);

    await expect(
      acquireLiveTurnHostLease({ runtimeSettings, leases: { tryAcquire } }),
    ).resolves.toBe(lease);
    expect(tryAcquire).toHaveBeenCalledWith(LIVE_TURN_HOST_LEASE_KEY);
  });

  it('fails startup when another runtime owns live turns', async () => {
    const runtimeSettings = createDefaultRuntimeSettings();
    const tryAcquire = vi.fn(async () => undefined);

    await expect(
      acquireLiveTurnHostLease({ runtimeSettings, leases: { tryAcquire } }),
    ).rejects.toThrow('Another Gantry runtime already owns live turns');
  });

  it('routes scope-active pending messages to the owning live turn', async () => {
    const completeSessionAgentRun = vi.fn(async () => undefined);
    const onRouted = vi.fn(async () => undefined);
    const routeMessage = vi.fn(async () => 'queued_to_owner' as const);

    await expect(
      routeScopeActiveLiveTurnAdmission({
        scope: {
          appId: 'app:test',
          agentSessionId: 'session-1',
          conversationId: 'chat-1',
          threadId: null,
        },
        queueJid: 'chat-1',
        liveRunId: 'run-redundant',
        continuation: {
          text: 'Ravi: continue',
          senderUserIds: ['user-1'],
          idempotencyKey: 'continuation:chat-1:msg-1',
          onRouted,
        },
        routeMessage,
        completeSessionAgentRun,
      }),
    ).resolves.toBe(true);

    expect(routeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        queueJid: 'chat-1',
        text: 'Ravi: continue',
        senderUserIds: ['user-1'],
        idempotencyKey: 'continuation:chat-1:msg-1',
      }),
    );
    expect(onRouted).toHaveBeenCalledOnce();
    expect(completeSessionAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-redundant',
        status: 'canceled',
      }),
    );
  });
});
