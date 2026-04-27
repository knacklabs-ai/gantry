import fs from 'fs';
import path from 'path';

import { isValidGroupFolder } from '../platform/group-folder.js';

export type HookPayload = {
  session_id?: string;
  sessionId?: string;
  user_id?: string;
  userId?: string;
  transcript_path?: string;
  transcriptPath?: string;
  cwd?: string;
  hook_event_name?: string;
  hookEventName?: string;
};

function isSafeSessionId(sessionId: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId)) return false;
  if (sessionId.includes('..')) return false;
  return true;
}

function normalizePath(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
}

function isWithin(rootDir: string, candidatePath: string): boolean {
  const rel = path.relative(rootDir, candidatePath);
  return !(rel.startsWith('..') || path.isAbsolute(rel));
}

function resolveRuntimeAndGroupFromAgentDir(agentDirRaw?: string): {
  runtimeHome?: string;
  groupFolder?: string;
} {
  const agentDir = normalizePath(agentDirRaw);
  if (!agentDir) return {};

  const marker = `${path.sep}agents${path.sep}`;
  const markerIndex = agentDir.lastIndexOf(marker);
  if (markerIndex === -1) return {};

  const runtimeHome = agentDir.slice(0, markerIndex) || undefined;
  const remainder = agentDir.slice(markerIndex + marker.length);
  const [groupFolder] = remainder.split(path.sep).filter(Boolean);

  return {
    runtimeHome,
    groupFolder:
      groupFolder && isValidGroupFolder(groupFolder) ? groupFolder : undefined,
  };
}

export async function resolveRuntimeAndGroup(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
): Promise<{
  runtimeHome?: string;
  groupFolder?: string;
  projectDir?: string;
}> {
  const explicitGroup = env.MYCLAW_GROUP_FOLDER?.trim();
  const projectDir = normalizePath(env.CLAUDE_PROJECT_DIR);
  const hookCwd = normalizePath(payload.cwd) || normalizePath(env.PWD);
  const fromAgentDir = resolveRuntimeAndGroupFromAgentDir(
    hookCwd || process.cwd(),
  );
  const runtimeHome =
    env.MYCLAW_HOME?.trim() || fromAgentDir.runtimeHome || undefined;

  let groupFolder: string | undefined;
  if (explicitGroup && isValidGroupFolder(explicitGroup)) {
    groupFolder = explicitGroup;
  } else if (fromAgentDir.groupFolder) {
    groupFolder = fromAgentDir.groupFolder;
  }

  return {
    runtimeHome,
    groupFolder,
    projectDir,
  };
}

export function resolveSessionId(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const raw =
    payload.session_id ||
    payload.sessionId ||
    env.CLAUDE_SESSION_ID ||
    undefined;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export function resolveUserId(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const raw =
    payload.user_id ||
    payload.userId ||
    env.MYCLAW_USER_ID ||
    env.CLAUDE_USER_ID ||
    undefined;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export function resolveTranscriptPath(
  payload: HookPayload,
  claudeConfigDir: string | undefined,
  sessionId: string | undefined,
): string | undefined {
  if (!claudeConfigDir || !sessionId || !isSafeSessionId(sessionId)) {
    return undefined;
  }

  const projectsRoot = path.resolve(claudeConfigDir, 'projects');
  const validateCandidate = (candidatePath: string): string | undefined => {
    if (!fs.existsSync(candidatePath)) return undefined;
    const baseName = path.basename(candidatePath);
    if (!baseName.endsWith('.jsonl')) return undefined;
    if (baseName !== `${sessionId}.jsonl`) return undefined;

    let resolvedTranscript: string;
    let resolvedRoot: string;
    try {
      resolvedTranscript = fs.realpathSync(candidatePath);
      resolvedRoot = fs.realpathSync(projectsRoot);
    } catch {
      return undefined;
    }
    return isWithin(resolvedRoot, resolvedTranscript)
      ? resolvedTranscript
      : undefined;
  };

  const raw = payload.transcript_path || payload.transcriptPath;
  const provided = normalizePath(raw);
  if (provided) {
    const validated = validateCandidate(provided);
    if (validated) return validated;
  }

  return undefined;
}
