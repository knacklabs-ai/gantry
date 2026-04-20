import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { AGENT_ROOT } from '../core/config.js';
import {
  ensureSharedSessionSettings as ensureRuntimeSharedSessionSettings,
  resolvePackageRootFromSourceDir,
  syncBundledSkills,
} from '../platform/claude-runtime-files.js';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePackageRootFromSourceDir(SOURCE_DIR);
const AGENT_RUNNER_HOST_DIR = path.join(REPO_ROOT, 'packages', 'agent-runner');
export const IPC_GROUP_SUBDIRS = [
  'messages',
  'tasks',
  'input',
  'memory-requests',
  'memory-responses',
  'browser-requests',
  'browser-responses',
  'permission-requests',
  'permission-responses',
  'user-questions',
  'user-answers',
  'task-responses',
] as const;

/**
 * Ensure shared .claude/settings.json under AGENT_ROOT.
 * This is the single HOME for all agent processes.
 */
export function ensureSharedSessionSettings(agentRoot = AGENT_ROOT): void {
  ensureRuntimeSharedSessionSettings(agentRoot);
}

/**
 * Ensure AGENT_ROOT/.claude/skills/ exists as a real directory.
 * Skills are managed directly under this directory (single source of truth).
 * Existing symlinks are migrated to real directories automatically.
 * Bundled skills are overwritten from the package on each startup.
 * User-installed skills with other names are left untouched.
 */
export function syncGroupSkills(agentRoot = AGENT_ROOT): void {
  syncBundledSkills(agentRoot);
}

export function getRepoAgentRunnerRoot(): string {
  return AGENT_RUNNER_HOST_DIR;
}

export function getHostAgentRunnerRoot(): string {
  return AGENT_RUNNER_HOST_DIR;
}

export function ensureGroupIpcLayout(groupIpcDir: string): void {
  for (const subdir of IPC_GROUP_SUBDIRS) {
    fs.mkdirSync(path.join(groupIpcDir, subdir), { recursive: true });
  }
}
