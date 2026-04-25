import { DATA_DIR } from '../../config/index.js';
import type { HostCredentialMode } from '../../config/credentials/mode.js';
import { envValue } from '../../config/env/index.js';
import type {
  AgentCredentialInjection,
  CredentialBrokerProfile,
} from '../../domain/models/credentials.js';
import type { AgentCredentialBroker } from '../../domain/ports/agent-credential-broker.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface AgentCredentialServiceOptions {
  mode: HostCredentialMode;
  broker?: AgentCredentialBroker;
  onecliUrl?: string;
  dataDir?: string;
}

export async function createAgentCredentialBroker(
  options: AgentCredentialServiceOptions,
): Promise<AgentCredentialBroker | undefined> {
  if (options.broker) return options.broker;
  if (options.mode !== 'onecli') return undefined;
  const { OnecliAgentCredentialBroker } =
    await import('../../adapters/credentials/onecli/broker.js');
  return new OnecliAgentCredentialBroker({
    onecliUrl: options.onecliUrl ?? envValue('ONECLI_URL'),
    dataDir: options.dataDir ?? DATA_DIR,
  });
}

export async function getAgentCredentialInjection(input: {
  mode: HostCredentialMode;
  agentIdentifier?: string;
  onecliUrl?: string;
  broker?: AgentCredentialBroker;
}): Promise<AgentCredentialInjection> {
  const broker = await createAgentCredentialBroker({
    mode: input.mode,
    broker: input.broker,
    onecliUrl: input.onecliUrl,
  });
  if (!broker) {
    return {
      env: {},
      applied: false,
      brokerProfile: input.mode as CredentialBrokerProfile,
    };
  }

  try {
    return await broker.getInjection({
      binding: {
        profile: input.mode,
        agentIdentifier: input.agentIdentifier,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, agentIdentifier: input.agentIdentifier || 'default' },
      'Agent credential broker not reachable',
    );
    if (
      message.includes('forbidden raw credential env key') ||
      message.includes('ONECLI_URL')
    ) {
      throw err;
    }
    if (input.mode === 'onecli') {
      throw new Error(
        'OneCLI credential mode is enabled but the OneCLI gateway is not reachable.',
      );
    }
    return {
      env: {},
      applied: false,
      brokerProfile: input.mode as CredentialBrokerProfile,
    };
  }
}
