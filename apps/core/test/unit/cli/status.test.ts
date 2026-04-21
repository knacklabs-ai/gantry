import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  collectRuntimeStatus,
  formatRuntimeStatus,
  type RuntimeStatusSummary,
} from '@core/cli/status.js';
import { settingsFilePath } from '@core/cli/runtime-home.js';
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
} from '@core/cli/runtime-settings.js';

function createRuntimeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myclaw-status-test-'));
  fs.mkdirSync(path.join(home, 'store'), { recursive: true });
  fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'data'), { recursive: true });
  return home;
}

function createReadySummary(
  service: RuntimeStatusSummary['service'],
): RuntimeStatusSummary {
  return {
    runtimeHome: '/tmp/myclaw',
    runtimeMode: 'host',
    doctor: {
      ok: true,
      warnings: 0,
      blockingFailures: 0,
      checks: [],
    },
    service,
    channels: [
      {
        id: 'telegram',
        label: 'Telegram',
        enabled: true,
        configuredEnvKeys: ['TELEGRAM_BOT_TOKEN'],
        missingEnvKeys: [],
        groups: 1,
      },
    ],
    memoryEnabled: true,
    memoryHealth: 'pass',
    memoryRoot: '/tmp/myclaw/memory',
    memoryRootSource: 'settings.yaml',
    memorySqlitePath: '/tmp/myclaw/memory/.cache/memory.db',
    memorySqlitePathSource: 'derived',
    storageProvider: 'sqlite',
    embeddingsEnabled: false,
    embeddingProvider: 'disabled',
    embeddingProviderSource: 'settings.yaml',
    embeddingProviderHealth: 'pass',
    embeddingModel: 'text-embedding-3-large',
    embeddingModelSource: 'settings.yaml',
    dreamingEnabled: false,
    dreamingSource: 'settings.yaml',
  };
}

describe('runtime status', () => {
  it('creates settings.yaml when collecting status', () => {
    const runtimeHome = createRuntimeHome();
    expect(fs.existsSync(settingsFilePath(runtimeHome))).toBe(false);

    const status = collectRuntimeStatus(import.meta.url, runtimeHome);

    expect(fs.existsSync(settingsFilePath(runtimeHome))).toBe(true);
    expect(
      status.channels.find((channel) => channel.id === 'telegram')?.enabled,
    ).toBe(false);
    expect(
      status.channels.find((channel) => channel.id === 'slack')?.enabled,
    ).toBe(false);
  });

  it('does not tell users to start an already running service', () => {
    const summary = createReadySummary({
      kind: 'launchd',
      status: 'running(pid:1234)',
    });

    const text = formatRuntimeStatus(summary);

    expect(text).toContain('Service (launchd): running(pid:1234)');
    expect(text).toContain('- MyClaw is running.');
    expect(text).toContain('Storage provider: sqlite');
    expect(text).toContain(
      'Memory DB path: /tmp/myclaw/memory/.cache/memory.db',
    );
    expect(text).not.toContain('Run `myclaw start`');
  });

  it('does not tell systemd users to start an active service', () => {
    const summary = createReadySummary({
      kind: 'systemd-user',
      status: 'active',
    });

    const text = formatRuntimeStatus(summary);

    expect(text).toContain('Service (systemd-user): active');
    expect(text).toContain('- MyClaw is running.');
    expect(text).not.toContain('Run `myclaw start`');
  });

  it('reports postgres storage provider and skips sqlite group counting', () => {
    const runtimeHome = createRuntimeHome();
    const settings = loadRuntimeSettings(runtimeHome);
    settings.storage.provider = 'postgres';
    settings.channels.telegram.enabled = true;
    saveRuntimeSettings(runtimeHome, settings);

    const status = collectRuntimeStatus(import.meta.url, runtimeHome);
    const telegram = status.channels.find(
      (channel) => channel.id === 'telegram',
    );

    expect(status.storageProvider).toBe('postgres');
    expect(telegram?.groups).toBe(0);
  });
});
