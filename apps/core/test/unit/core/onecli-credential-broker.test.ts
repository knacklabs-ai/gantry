import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const getContainerConfig = vi.hoisted(() => vi.fn());
const ensureAgent = vi.hoisted(() => vi.fn());

vi.mock('@onecli-sh/sdk', () => ({
  OneCLI: vi.fn(function () {
    return {
      getContainerConfig,
      ensureAgent,
    };
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('OnecliAgentCredentialBroker', () => {
  it('returns broker-safe injection env and materializes certificate refs', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myclaw-onecli-'));
    getContainerConfig.mockResolvedValue({
      env: {
        ANTHROPIC_BASE_URL: 'https://broker.local/anthropic',
        HTTPS_PROXY: 'http://x:aoc_123@host.docker.internal:10255',
        NODE_EXTRA_CA_CERTS: '/container/ca.pem',
      },
      caCertificate: 'cert-data',
    });

    const { OnecliAgentCredentialBroker } =
      await import('@core/adapters/credentials/onecli/broker.js');
    const broker = new OnecliAgentCredentialBroker({
      onecliUrl: 'http://localhost:10254',
      dataDir,
    });

    const injection = await broker.getInjection({
      binding: {
        profile: 'onecli',
        agentIdentifier: 'agent-a',
      },
    });

    expect(getContainerConfig).toHaveBeenCalledWith('agent-a');
    expect(injection).toMatchObject({
      applied: true,
      brokerProfile: 'onecli',
      env: {
        ANTHROPIC_BASE_URL: 'https://broker.local/anthropic',
        HTTPS_PROXY: 'http://x:aoc_123@127.0.0.1:10255/',
        NODE_EXTRA_CA_CERTS: path.join(dataDir, 'onecli/gateway-ca.pem'),
      },
      proxy: {
        https: 'http://x:aoc_123@127.0.0.1:10255/',
      },
      certificates: {
        nodeExtraCaCertsPath: path.join(dataDir, 'onecli/gateway-ca.pem'),
      },
    });
    expect(
      fs.readFileSync(path.join(dataDir, 'onecli/gateway-ca.pem'), 'utf-8'),
    ).toBe('cert-data');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('fails closed when OneCLI returns raw runtime or provider secrets', async () => {
    getContainerConfig.mockResolvedValue({
      env: {
        MYCLAW_DATABASE_URL: 'postgres://runtime-secret',
      },
    });

    const { OnecliAgentCredentialBroker } =
      await import('@core/adapters/credentials/onecli/broker.js');
    const broker = new OnecliAgentCredentialBroker({
      onecliUrl: 'http://localhost:10254',
      dataDir: os.tmpdir(),
    });

    await expect(
      broker.getInjection({ binding: { profile: 'onecli' } }),
    ).rejects.toThrow(/MYCLAW_DATABASE_URL/);
  });
});
