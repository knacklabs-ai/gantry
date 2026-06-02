import http from 'http';
import net from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeEgressGateway,
  closeEgressGatewaysForTest,
  ensureEgressGateway,
} from '@core/runtime/egress-gateway.js';

afterEach(async () => {
  await closeEgressGatewaysForTest();
});

describe('egress gateway', () => {
  it('allows CONNECT by default and audits the decision', async () => {
    const target = await startTargetServer();
    const publishRuntimeEvent = vi.fn();
    const gateway = await ensureEgressGateway({
      key: 'test:allow',
      settings: { denylist: [] },
      principal: {
        appId: 'default',
        agentId: 'agent:test',
        conversationId: 'tg:test',
        runId: 'run-1',
      },
      publishRuntimeEvent,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: `127.0.0.1:${target.port}`,
    });

    expect(response.statusCode).toBe(200);
    const auditEvent = publishRuntimeEvent.mock.calls[0]?.[0];
    expect(auditEvent).toEqual(
      expect.objectContaining({
        eventType: 'egress.connect',
        agentId: 'agent:test',
        conversationId: 'conversation:tg:test',
        payload: expect.objectContaining({
          host: '127.0.0.1',
          allowed: true,
          denied: false,
          reason: 'default_allow',
          principal: 'agent:test',
          conversationId: 'tg:test',
          runId: 'run-1',
        }),
      }),
    );
    expect(auditEvent).not.toHaveProperty('runId');
    await target.close();
  });

  it('attributes a declared host to its reviewed capability in the audit event', async () => {
    const upstream = await startRecordingProxy();
    const publishRuntimeEvent = vi.fn();
    const gateway = await ensureEgressGateway({
      key: 'test:attribution',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      lookupHostname: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ]),
      upstreamProxy: {
        provider: 'test-proxy',
        url: `http://127.0.0.1:${upstream.port}/`,
      },
      publishRuntimeEvent,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(response.statusCode).toBe(502);
    expect(upstream.headers[0]).toContain('CONNECT 93.184.216.34:443 HTTP/1.1');
    expect(upstream.headers[0]).toContain('Host: api.linkedin.com:443');
    const auditEvent = publishRuntimeEvent.mock.calls[0]?.[0];
    expect(auditEvent).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          host: 'api.linkedin.com',
          allowed: true,
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        }),
      }),
    );
    await upstream.close();
  });

  it('honors explicit unrestricted mode when some capability hosts are attributed', async () => {
    const target = await startTargetServer();
    const publishRuntimeEvent = vi.fn();
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-explicit-unrestricted',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      restrictToAttributedNetworkHosts: false,
      publishRuntimeEvent,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: `127.0.0.1:${target.port}`,
    });

    expect(response.statusCode).toBe(200);
    expect(publishRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'egress.connect',
        payload: expect.objectContaining({
          host: '127.0.0.1',
          allowed: true,
          denied: false,
          reason: 'default_allow',
        }),
      }),
    );
    await target.close();
  });

  it('denies attributed declared hosts that resolve to private addresses', async () => {
    const publishRuntimeEvent = vi.fn();
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-private-dns',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      lookupHostname: vi.fn(async () => [
        { address: '127.0.0.1', family: 4 as const },
      ]),
      publishRuntimeEvent,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network host api.linkedin.com resolved to private, loopback, or link-local address 127.0.0.1.',
      recovery: 'request or update network access',
    });
    expect(publishRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'egress.connect',
        payload: expect.objectContaining({
          host: 'api.linkedin.com',
          denied: true,
          matchedPattern: 'capability_network_host',
          capabilityId: 'skill.linkedin-posting.publish',
        }),
      }),
    );
  });

  it('fails closed when attributed host DNS validation times out', async () => {
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-dns-timeout',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      lookupHostname: vi.fn(
        () => new Promise<Array<{ address: string; family: 4 | 6 }>>(() => {}),
      ),
      dnsLookupTimeoutMs: 1,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network host api.linkedin.com could not be resolved safely.',
      recovery: 'request or update network access',
    });
  });

  it('denies attributed declared hosts on undeclared ports', async () => {
    const publishRuntimeEvent = vi.fn();
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-wrong-port',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      lookupHostname: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ]),
      publishRuntimeEvent,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:8443',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network access did not declare api.linkedin.com:8443.',
      recovery: 'request or update network access',
    });
    expect(publishRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'egress.connect',
        payload: expect.objectContaining({
          host: 'api.linkedin.com',
          denied: true,
          matchedPattern: 'capability_network_host',
        }),
      }),
    );
  });

  it('denies undeclared hosts when capability network hosts are present', async () => {
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-undeclared-host',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      lookupHostname: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ]),
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'evil.example.com:443',
    });

    expect(response.statusCode).toBe(403);
    expect(response.statusLine).toContain(
      'Gantry blocked egress to evil.example.com; request or update network access',
    );
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'evil.example.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network access did not declare evil.example.com:443.',
      recovery: 'request or update network access',
    });
  });

  it('allows undeclared hosts when attributed host restriction is explicitly off', async () => {
    const target = await startTargetServer();
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-open-egress',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:443',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      restrictToAttributedNetworkHosts: false,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: `127.0.0.1:${target.port}`,
    });

    expect(response.statusCode).toBe(200);
    await target.close();
  });

  it('denies external hosts when restricted mode has no declared hosts', async () => {
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-restricted-empty',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [],
      restrictToAttributedNetworkHosts: true,
      lookupHostname: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ]),
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network access did not declare api.linkedin.com:443.',
      recovery: 'request or update network access',
    });
  });

  it('allows model-provider hosts separately from restricted capability hosts', async () => {
    const target = await startTargetServer();
    const gateway = await ensureEgressGateway({
      key: 'test:model-provider-restricted',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      modelProviderNetworkHosts: [`127.0.0.1:${target.port}`],
      networkAttribution: [],
      restrictToAttributedNetworkHosts: true,
    });

    const allowed = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: `127.0.0.1:${target.port}`,
    });
    const denied = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network access did not declare api.linkedin.com:443.',
      recovery: 'request or update network access',
    });
    await target.close();
  });

  it('fails closed for attributed HTTP proxy requests when upstream proxy cannot preserve DNS pinning', async () => {
    const upstream = await startRecordingProxy();
    const gateway = await ensureEgressGateway({
      key: 'test:attribution-http-upstream-proxy',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      networkAttribution: [
        {
          host: 'api.linkedin.com:80',
          capabilityId: 'skill.linkedin-posting.publish',
          capabilityLabel: 'LinkedIn Posting publish',
        },
      ],
      lookupHostname: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
      ]),
      upstreamProxy: {
        provider: 'test-proxy',
        url: `http://127.0.0.1:${upstream.port}/`,
      },
    });

    const response = await httpRequestThroughGateway({
      gatewayPort: gateway.port,
      url: 'http://api.linkedin.com/post',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'capability_network_host',
      reason:
        'Capability-declared network host api.linkedin.com cannot be DNS-pinned through an upstream HTTP proxy request.',
      recovery: 'request or update network access',
    });
    expect(upstream.headers).toEqual([]);
    await upstream.close();
  });

  it('keeps default-allowed CONNECT traffic working when audit persistence fails', async () => {
    const target = await startTargetServer();
    const publishRuntimeEvent = vi.fn(async () => {
      throw new Error('audit store unavailable');
    });
    const gateway = await ensureEgressGateway({
      key: 'test:allow-audit-failure',
      settings: { denylist: [] },
      principal: {
        appId: 'default',
        agentId: 'agent:test',
        conversationId: 'tg:test',
      },
      publishRuntimeEvent,
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: `127.0.0.1:${target.port}`,
    });

    expect(response.statusCode).toBe(200);
    expect(publishRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'egress.connect' }),
    );
    await target.close();
  });

  it('returns useful 403 JSON when denylist matches', async () => {
    const gateway = await ensureEgressGateway({
      key: 'test:deny',
      settings: { denylist: ['api.linkedin.com'] },
      principal: { appId: 'default', agentId: 'agent:test' },
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'api.linkedin.com',
      reason:
        'Host api.linkedin.com matched permissions.egress.denylist pattern api.linkedin.com.',
    });
  });

  it('applies denylist rules to trailing-dot CONNECT hostnames', async () => {
    const gateway = await ensureEgressGateway({
      key: 'test:deny-trailing-dot',
      settings: { denylist: ['api.linkedin.com'] },
      principal: { appId: 'default', agentId: 'agent:test' },
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com.:443',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      deniedHost: 'api.linkedin.com',
      matchedPattern: 'api.linkedin.com',
      reason:
        'Host api.linkedin.com matched permissions.egress.denylist pattern api.linkedin.com.',
    });
  });

  it('returns 502 when upstream proxy closes before CONNECT headers', async () => {
    const upstream = await startClosingProxy();
    const gateway = await ensureEgressGateway({
      key: 'test:upstream-close',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
      upstreamProxy: {
        provider: 'test-proxy',
        url: `http://127.0.0.1:${upstream.port}/`,
      },
    });

    const response = await connectThroughGateway({
      gatewayPort: gateway.port,
      authority: 'api.linkedin.com:443',
    });

    expect(response.statusCode).toBe(502);
    await upstream.close();
  });

  it('closes promptly while CONNECT tunnels are still open', async () => {
    const target = await startHoldingTarget();
    const gateway = await ensureEgressGateway({
      key: 'test:close-open-connect',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
    });

    const tunnel = await openTunnelThroughGateway({
      gatewayPort: gateway.port,
      authority: `127.0.0.1:${target.port}`,
    });

    await expect(
      Promise.race([
        closeEgressGateway(gateway),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('closeEgressGateway timed out')),
            500,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
    await waitForSocketClose(tunnel);
    await target.close();
  });

  it('keeps running when a CONNECT client resets an established tunnel', async () => {
    const target = await startHoldingTarget();
    const gateway = await ensureEgressGateway({
      key: 'test:client-reset-connect',
      settings: { denylist: [] },
      principal: { appId: 'default', agentId: 'agent:test' },
    });
    const uncaught = vi.fn();
    process.once('uncaughtException', uncaught);

    try {
      const tunnel = await openTunnelThroughGateway({
        gatewayPort: gateway.port,
        authority: `127.0.0.1:${target.port}`,
      });
      tunnel.resetAndDestroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.removeListener('uncaughtException', uncaught);
      await target.close();
    }
  });
});

async function startTargetServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = http.createServer((_req, res) => {
    res.end('ok');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Target server did not bind to TCP.');
  }
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function startClosingProxy(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = net.createServer((socket) => {
    socket.destroy();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Closing proxy did not bind to TCP.');
  }
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function startRecordingProxy(): Promise<{
  port: number;
  headers: string[];
  close: () => Promise<void>;
}> {
  const headers: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
    let buffered = '';
    socket.setEncoding('utf-8');
    socket.on('data', (chunk) => {
      buffered += chunk;
      if (!buffered.includes('\r\n\r\n')) return;
      headers.push(buffered.slice(0, buffered.indexOf('\r\n\r\n')));
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Recording proxy did not bind to TCP.');
  }
  return {
    port: address.port,
    headers,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function startHoldingTarget(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Holding target did not bind to TCP.');
  }
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function openTunnelThroughGateway(input: {
  gatewayPort: number;
  authority: string;
}): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let response = '';
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const socket = net.connect(input.gatewayPort, '127.0.0.1', () => {
      socket.write(
        [`CONNECT ${input.authority} HTTP/1.1`, `Host: ${input.authority}`, '']
          .join('\r\n')
          .concat('\r\n'),
      );
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!/^HTTP\/1\.[01]\s+200\b/.test(response)) {
        socket.destroy();
        reject(new Error(`CONNECT response was not 200: ${response}`));
        return;
      }
      resolve(socket);
    };
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`Timed out waiting for CONNECT response: ${response}`));
    }, 1_000);
    socket.setEncoding('utf-8');
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\r\n\r\n')) finish();
    });
    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForSocketClose(socket: net.Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Socket did not close after gateway shutdown'));
    }, 500);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function connectThroughGateway(input: {
  gatewayPort: number;
  authority: string;
}): Promise<{ statusCode: number; statusLine: string; body: string }> {
  return new Promise((resolve, reject) => {
    let response = '';
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const socket = net.connect(input.gatewayPort, '127.0.0.1', () => {
      socket.write(
        [`CONNECT ${input.authority} HTTP/1.1`, `Host: ${input.authority}`, '']
          .join('\r\n')
          .concat('\r\n'),
      );
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const statusLine = response.split('\r\n', 1)[0] ?? '';
      const status = statusLine.match(/^HTTP\/1\.[01]\s+(\d+)/);
      if (!status) {
        reject(
          new Error(`CONNECT response did not include a status: ${response}`),
        );
        return;
      }
      const [, statusCode] = status;
      const body = response.includes('\r\n\r\n')
        ? response.slice(response.indexOf('\r\n\r\n') + 4)
        : '';
      resolve({ statusCode: Number(statusCode), statusLine, body });
    };
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`Timed out waiting for CONNECT response: ${response}`));
    }, 1_000);
    socket.setEncoding('utf-8');
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\r\n\r\n')) {
        socket.end();
      }
    });
    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    socket.once('end', finish);
    socket.once('close', finish);
  });
}

function httpRequestThroughGateway(input: {
  gatewayPort: number;
  url: string;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: input.gatewayPort,
        method: 'GET',
        path: input.url,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
