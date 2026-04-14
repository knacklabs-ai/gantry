import { spawn } from 'child_process';

import * as p from '@clack/prompts';

import { readEnvFile, upsertEnvFile } from './env-file.js';
import { commandExists } from './platform.js';
import { envFilePath, ensureRuntimeLayout } from './runtime-home.js';

function usage(): string {
  return [
    'Tunnel commands:',
    '  myclaw tunnel quick',
    '',
    'Starts cloudflared quick tunnel and auto-updates MINI_APP_API_URL in .env.',
  ].join('\n');
}

function parsePort(raw: string | undefined): number {
  const value = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(value) || value < 1 || value > 65535) return 3100;
  return value;
}

const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

async function runQuickTunnel(runtimeHome: string): Promise<number> {
  if (!commandExists('cloudflared')) {
    p.log.error(
      'cloudflared is not installed. Install Cloudflare Tunnel first, then retry.',
    );
    return 1;
  }

  ensureRuntimeLayout(runtimeHome);
  const envPath = envFilePath(runtimeHome);
  const env = readEnvFile(envPath);
  const port = parsePort(env.MINI_APP_PORT);
  const targetUrl = `http://localhost:${port}`;

  p.note(
    [
      `Runtime home: ${runtimeHome}`,
      `Target API: ${targetUrl}`,
      'Waiting for cloudflared quick tunnel URL...',
    ].join('\n'),
    'Tunnel',
  );

  const child = spawn('cloudflared', ['tunnel', '--url', targetUrl], {
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  let discoveredUrl: string | null = null;

  const maybeCaptureUrl = (text: string) => {
    const match = text.match(QUICK_TUNNEL_URL_PATTERN);
    if (!match || discoveredUrl) return;
    discoveredUrl = match[0];
    upsertEnvFile(envPath, {
      MINI_APP_API_URL: discoveredUrl,
      MINI_APP_ENABLED: 'true',
    });
    p.log.success(`MINI_APP_API_URL updated: ${discoveredUrl}`);
    p.log.info(
      'Tunnel is running. Keep this command open while using Mini App.',
    );
  };

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    process.stdout.write(text);
    maybeCaptureUrl(text);
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    process.stderr.write(text);
    maybeCaptureUrl(text);
  });

  return new Promise((resolve) => {
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      p.log.error(`Failed to start cloudflared: ${message}`);
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      if (!discoveredUrl) {
        p.log.error(
          'cloudflared exited before a quick tunnel URL was detected.',
        );
        resolve(1);
        return;
      } else if (signal) {
        p.log.info(`Tunnel stopped (${signal}).`);
      } else {
        p.log.info(`Tunnel stopped (exit code ${code ?? 0}).`);
      }
      resolve(code === 0 || signal === 'SIGINT' ? 0 : 1);
    });
  });
}

export async function runTunnelCommand(
  runtimeHome: string,
  args: string[],
): Promise<number> {
  const [subcommand] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(usage());
    return subcommand ? 0 : 1;
  }

  if (subcommand === 'quick') {
    return runQuickTunnel(runtimeHome);
  }

  p.log.error(`Unknown tunnel command: ${subcommand}`);
  console.log(usage());
  return 1;
}
