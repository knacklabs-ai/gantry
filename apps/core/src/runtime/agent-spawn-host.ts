import fs from 'fs';
import path from 'path';

import {
  AGENTS_DIR,
  DATA_DIR,
  getCredentialBrokerRuntimeConfig,
  getHostCredentialEnv,
} from '../config/index.js';
import { validateExternalBrokerUrl } from '../config/credentials/broker-url-policy.js';
import { getAgentCredentialInjection } from '../application/credentials/agent-credential-service.js';
import { createAgentCredentialBroker } from '../adapters/credentials/agent-credential-broker-factory.js';
import { createExternalAgentCredentialInjection } from '../adapters/llm/external-credential-injection.js';
import { RegisteredGroup } from '../domain/types.js';
import type { AgentCredentialBroker } from '../domain/ports/agent-credential-broker.js';
import type { CredentialBrokerProfile } from '../domain/models/credentials.js';
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
  broker?: AgentCredentialBroker,
): Promise<{
  env: Record<string, string>;
  brokerApplied: boolean;
  brokerProfile: CredentialBrokerProfile;
}> {
  const brokerConfig = getCredentialBrokerRuntimeConfig();
  const resolvedBroker =
    broker ??
    (await createAgentCredentialBroker({
      mode: brokerConfig.mode,
      onecliUrl: brokerConfig.onecliUrl,
      dataDir: DATA_DIR,
    }));
  const externalInjection =
    brokerConfig.mode === 'external'
      ? createExternalAgentCredentialInjection({
          normalizedBaseUrl: resolveExternalCredentialBaseUrl(
            brokerConfig.externalBrokerBaseUrl,
          ),
          hostCredentialEnv: getHostCredentialEnv(),
        })
      : undefined;
  const injection = await getAgentCredentialInjection({
    mode: brokerConfig.mode,
    agentIdentifier,
    broker: resolvedBroker,
    externalInjection,
  });

  return {
    env: injection.env,
    brokerApplied: injection.applied,
    brokerProfile: injection.brokerProfile,
  };
}

function resolveExternalCredentialBaseUrl(rawBrokerUrl: string): string {
  const validation = validateExternalBrokerUrl(
    rawBrokerUrl,
    'credential_broker.external.base_url',
  );
  if (!validation.ok || !validation.normalizedUrl) {
    throw new Error(
      validation.error || 'credential_broker.external.base_url is invalid.',
    );
  }
  return validation.normalizedUrl;
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
