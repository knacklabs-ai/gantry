import fs from 'fs';
import path from 'path';

import {
  AGENTS_DIR,
  MYCLAW_CREDENTIAL_MODE,
  ONECLI_URL,
} from '../config/index.js';
import { resolveHostCredentialMode } from '../config/credentials/mode.js';
import { getAgentCredentialInjection } from '../application/credentials/agent-credential-service.js';
import { RegisteredGroup } from '../domain/types.js';
import {
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from '../platform/group-folder.js';
import {
  ensureGroupIpcLayout,
  getHostAgentRunnerDistDir,
  ensureSharedSessionSettings,
  syncGroupSkills,
} from './agent-spawn-layout.js';
import { HostRuntimeContext } from './agent-spawn-types.js';

export async function getHostRuntimeCredentialEnv(
  agentIdentifier?: string,
): Promise<{
  env: Record<string, string>;
  onecliApplied: boolean;
}> {
  const credentialModeRaw = MYCLAW_CREDENTIAL_MODE;
  const credentialMode = resolveHostCredentialMode(credentialModeRaw);
  const injection = await getAgentCredentialInjection({
    mode: credentialMode,
    agentIdentifier,
    onecliUrl: ONECLI_URL,
  });

  return {
    env: injection.env,
    onecliApplied: injection.brokerProfile === 'onecli' && injection.applied,
  };
}

export function prepareHostRuntimeContext(
  group: RegisteredGroup,
): HostRuntimeContext {
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Shared .claude/ under runtime home for skills, settings, plugins.
  ensureSharedSessionSettings();
  syncGroupSkills();
  const runnerDistDir = getHostAgentRunnerDistDir();

  const groupIpcDir = resolveGroupIpcPath(group.folder);
  ensureGroupIpcLayout(groupIpcDir);

  const sharedDirCandidate = path.join(AGENTS_DIR, 'shared');
  const globalDir = fs.existsSync(sharedDirCandidate)
    ? sharedDirCandidate
    : undefined;

  return {
    groupDir,
    globalDir,
    groupIpcDir,
    runnerDistDir,
  };
}
