import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface LoadOptions {
  hasCloudflared?: boolean;
  env?: Record<string, string>;
}

interface ChildLike extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function createChild(): ChildLike {
  const child = new EventEmitter() as ChildLike;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

async function loadTunnelModule(options: LoadOptions = {}) {
  vi.resetModules();

  const logError = vi.fn();
  const logSuccess = vi.fn();
  const logInfo = vi.fn();
  const note = vi.fn();
  const upsertEnvFile = vi.fn();
  const readEnvFile = vi.fn(() => options.env || {});
  const ensureRuntimeLayout = vi.fn();
  const envFilePath = vi.fn(() => '/tmp/myclaw/.env');
  const commandExists = vi.fn(() => options.hasCloudflared ?? true);
  const child = createChild();
  const spawn = vi.fn(() => child);

  vi.doMock('@clack/prompts', () => ({
    log: {
      error: logError,
      success: logSuccess,
      info: logInfo,
    },
    note,
  }));
  vi.doMock('./env-file.js', () => ({
    readEnvFile,
    upsertEnvFile,
  }));
  vi.doMock('./runtime-home.js', () => ({
    ensureRuntimeLayout,
    envFilePath,
  }));
  vi.doMock('./platform.js', () => ({
    commandExists,
  }));
  vi.doMock('child_process', () => ({
    spawn,
  }));

  const mod = await import('./tunnel.js');
  return {
    runTunnelCommand: mod.runTunnelCommand,
    child,
    spawn,
    upsertEnvFile,
    logError,
    logSuccess,
  };
}

describe('runTunnelCommand', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when cloudflared is not installed', async () => {
    const mod = await loadTunnelModule({ hasCloudflared: false });
    const code = await mod.runTunnelCommand('/tmp/myclaw', ['quick']);
    expect(code).toBe(1);
    expect(mod.logError).toHaveBeenCalledWith(
      expect.stringContaining('cloudflared is not installed'),
    );
  });

  it('starts quick tunnel and updates MINI_APP_API_URL from detected URL', async () => {
    const mod = await loadTunnelModule({ env: { MINI_APP_PORT: '3200' } });
    const pending = mod.runTunnelCommand('/tmp/myclaw', ['quick']);

    expect(mod.spawn).toHaveBeenCalledWith(
      'cloudflared',
      ['tunnel', '--url', 'http://localhost:3200'],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    mod.child.stderr.emit(
      'data',
      'INF Visit https://alpha-beta.trycloudflare.com to access\n',
    );
    mod.child.emit('exit', 0, null);

    const code = await pending;
    expect(code).toBe(0);
    expect(mod.upsertEnvFile).toHaveBeenCalledWith('/tmp/myclaw/.env', {
      MINI_APP_API_URL: 'https://alpha-beta.trycloudflare.com',
      MINI_APP_ENABLED: 'true',
    });
    expect(mod.logSuccess).toHaveBeenCalledWith(
      expect.stringContaining('MINI_APP_API_URL updated'),
    );
  });

  it('fails when interrupted before quick tunnel URL is detected', async () => {
    const mod = await loadTunnelModule({ env: { MINI_APP_PORT: '3100' } });
    const pending = mod.runTunnelCommand('/tmp/myclaw', ['quick']);

    mod.child.emit('exit', null, 'SIGINT');

    const code = await pending;
    expect(code).toBe(1);
    expect(mod.logError).toHaveBeenCalledWith(
      expect.stringContaining('before a quick tunnel URL was detected'),
    );
  });

  it('succeeds when interrupted after quick tunnel URL is detected', async () => {
    const mod = await loadTunnelModule({ env: { MINI_APP_PORT: '3100' } });
    const pending = mod.runTunnelCommand('/tmp/myclaw', ['quick']);

    mod.child.stdout.emit(
      'data',
      'INF Visit https://stable-now.trycloudflare.com to access\n',
    );
    mod.child.emit('exit', null, 'SIGINT');

    const code = await pending;
    expect(code).toBe(0);
    expect(mod.upsertEnvFile).toHaveBeenCalledWith('/tmp/myclaw/.env', {
      MINI_APP_API_URL: 'https://stable-now.trycloudflare.com',
      MINI_APP_ENABLED: 'true',
    });
  });
});
