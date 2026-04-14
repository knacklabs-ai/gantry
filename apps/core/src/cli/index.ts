#!/usr/bin/env node

import * as p from '@clack/prompts';

import {
  hasProcessableGroupForConfiguredChannel,
  formatDoctorReport,
  hasRegisteredAnyGroup,
  hasRuntimeConfig,
  runDoctorWithNetwork,
} from './doctor.js';
import { runConfigCommand } from './config.js';
import { runGroupCommand } from './group.js';
import {
  clearOnboardingState,
  createInitialState,
  readOnboardingState,
  writeOnboardingState,
} from './onboarding-state.js';
import { resolveRuntimeHome } from './runtime-home.js';
import {
  installService,
  startService,
  stopService,
} from './service-manager.js';
import { runSlackConnectCommand } from './slack.js';
import { runSetupFlow } from './setup-flow.js';
import { collectRuntimeStatus, formatRuntimeStatus } from './status.js';
import { runTunnelCommand } from './tunnel.js';

interface ParsedArgs {
  command: string[];
  runtimeHomeArg?: string;
  help: boolean;
}

function usage(): string {
  return [
    'MyClaw CLI',
    '',
    'Usage:',
    '  myclaw',
    '  myclaw setup',
    '  myclaw doctor',
    '  myclaw status',
    '  myclaw start',
    '  myclaw config list',
    '  myclaw config get <KEY>',
    '  myclaw config set <KEY> <VALUE>',
    '  myclaw config unset <KEY>',
    '  myclaw group list',
    '  myclaw group info <jid|folder>',
    '  myclaw group add <jid|chat-id>',
    '  myclaw group remove <jid|folder>',
    '  myclaw group trigger <jid|folder> <word>',
    '  myclaw telegram connect',
    '  myclaw slack connect',
    '  myclaw tunnel quick',
    '  myclaw service install',
    '  myclaw service start',
    '  myclaw service stop',
    '',
    'Options:',
    '  --runtime-home <path>   Override runtime home (default: ~/myclaw)',
    '  -h, --help              Show help',
  ].join('\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  let runtimeHomeArg: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--runtime-home') {
      runtimeHomeArg = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--runtime-home=')) {
      runtimeHomeArg = arg.slice('--runtime-home='.length);
      continue;
    }
    command.push(arg);
  }

  return { command, runtimeHomeArg, help };
}

async function runDoctorCommand(
  importMetaUrl: string,
  runtimeHome: string,
): Promise<number> {
  const report = await runDoctorWithNetwork(importMetaUrl, runtimeHome);
  p.note(formatDoctorReport(report), 'Doctor');
  return report.ok ? 0 : 1;
}

async function runStatusCommand(
  importMetaUrl: string,
  runtimeHome: string,
): Promise<number> {
  const summary = collectRuntimeStatus(importMetaUrl, runtimeHome);
  p.note(formatRuntimeStatus(summary), 'Status');
  return summary.doctor.ok ? 0 : 1;
}

async function runStartCommand(runtimeHome: string): Promise<number> {
  if (!hasRuntimeConfig(runtimeHome)) {
    p.log.error(
      'Setup is incomplete. Next action: run `myclaw setup` before starting.',
    );
    return 1;
  }
  if (!hasRegisteredAnyGroup(runtimeHome)) {
    p.log.error(
      'No channel group is connected. Next action: run `myclaw telegram connect` or `myclaw slack connect`.',
    );
    return 1;
  }
  if (!hasProcessableGroupForConfiguredChannel(runtimeHome)) {
    p.log.error(
      'Configured channels do not match connected groups. Next action: connect a group for a configured channel (run `myclaw telegram connect` or `myclaw slack connect`).',
    );
    return 1;
  }

  process.env.AGENT_ROOT = runtimeHome;
  const runtime = await import('../index.js');
  await runtime.startMyClawRuntime();
  return 0;
}

async function runServiceCommand(
  importMetaUrl: string,
  runtimeHome: string,
  action: string,
): Promise<number> {
  if (action === 'install') {
    const outcome = installService(importMetaUrl, runtimeHome);
    if (!outcome.ok) {
      p.log.error(`Service install failed: ${outcome.message}`);
      return 1;
    }
    p.log.success(outcome.message);
    return 0;
  }

  if (action === 'start') {
    const outcome = startService(runtimeHome);
    if (!outcome.ok) {
      p.log.error(`Service start failed: ${outcome.message}`);
      return 1;
    }
    p.log.success(outcome.message);
    return 0;
  }

  if (action === 'stop') {
    const outcome = stopService(runtimeHome);
    if (!outcome.ok) {
      p.log.error(`Service stop failed: ${outcome.message}`);
      return 1;
    }
    p.log.success(outcome.message);
    return 0;
  }

  p.log.error('Unknown service command. Use install, start, or stop.');
  return 1;
}

async function runSetupCommand(
  runtimeHome: string,
  initialStep?:
    | 'welcome'
    | 'doctor'
    | 'runtime_home'
    | 'prerequisites'
    | 'telegram'
    | 'memory'
    | 'embeddings'
    | 'dreaming'
    | 'config'
    | 'group'
    | 'service'
    | 'verify'
    | 'ready',
): Promise<number> {
  const state = readOnboardingState(runtimeHome);
  let startStep = initialStep;

  if (state?.status === 'completed' && !initialStep) {
    clearOnboardingState(runtimeHome);
    writeOnboardingState(runtimeHome, createInitialState(runtimeHome));
    startStep = 'welcome';
  }

  if (state?.status === 'in_progress' && !initialStep) {
    const decision = await p.select({
      message: 'You already have an unfinished setup. What do you want to do?',
      options: [
        {
          value: 'resume',
          label: 'Resume previous setup (Recommended)',
        },
        {
          value: 'restart',
          label: 'Start from the beginning',
        },
        {
          value: 'cancel',
          label: 'Cancel',
        },
      ],
    });
    if (p.isCancel(decision) || decision === 'cancel') {
      p.outro('Setup cancelled.');
      return 1;
    }
    if (decision === 'resume') {
      startStep = state.currentStep;
    }
    if (decision === 'restart') {
      clearOnboardingState(runtimeHome);
      writeOnboardingState(runtimeHome, createInitialState(runtimeHome));
      startStep = 'welcome';
    }
  }

  const result = await runSetupFlow({
    importMetaUrl: import.meta.url,
    runtimeHome,
    initialStep: startStep,
  });
  if (result.status === 'completed') {
    await runStatusCommand(import.meta.url, result.runtimeHome);
    return 0;
  }
  if (result.status === 'resumed') {
    return 0;
  }
  return 1;
}

async function runSmartEntrypoint(runtimeHome: string): Promise<number> {
  const state = readOnboardingState(runtimeHome);
  const hasConfig = hasRuntimeConfig(runtimeHome);
  const hasGroup = hasRegisteredAnyGroup(runtimeHome);
  const hasProcessableGroup =
    hasProcessableGroupForConfiguredChannel(runtimeHome);

  if (
    !hasConfig ||
    !hasGroup ||
    !hasProcessableGroup ||
    state?.status === 'in_progress'
  ) {
    return runSetupCommand(runtimeHome);
  }

  return runStatusCommand(import.meta.url, runtimeHome);
}

async function runTelegramConnectCommand(runtimeHome: string): Promise<number> {
  return runSetupCommand(runtimeHome, 'telegram');
}

async function runSlackConnect(runtimeHome: string): Promise<number> {
  return runSlackConnectCommand(runtimeHome);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    return 0;
  }

  const runtimeHome = resolveRuntimeHome(parsed.runtimeHomeArg);
  const [command, ...rest] = parsed.command;
  const subcommand = rest[0];

  if (!command) {
    return runSmartEntrypoint(runtimeHome);
  }

  if (command === 'setup') {
    return runSetupCommand(runtimeHome);
  }

  if (command === 'doctor') {
    return runDoctorCommand(import.meta.url, runtimeHome);
  }

  if (command === 'status') {
    return runStatusCommand(import.meta.url, runtimeHome);
  }

  if (command === 'start') {
    return runStartCommand(runtimeHome);
  }

  if (command === 'group') {
    return runGroupCommand(runtimeHome, rest);
  }

  if (command === 'config') {
    return runConfigCommand(runtimeHome, rest);
  }

  if (command === 'telegram' && subcommand === 'connect') {
    return runTelegramConnectCommand(runtimeHome);
  }

  if (command === 'slack' && subcommand === 'connect') {
    return runSlackConnect(runtimeHome);
  }

  if (command === 'tunnel') {
    return runTunnelCommand(runtimeHome, rest);
  }

  if (command === 'service' && subcommand) {
    return runServiceCommand(import.meta.url, runtimeHome, subcommand);
  }

  console.log(usage());
  return 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(`MyClaw CLI failed: ${message}`);
    process.exit(1);
  });
