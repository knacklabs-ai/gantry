import type { AgentCredentialInjection } from '../../domain/models/credentials.js';

export function createExternalAgentCredentialInjection(input: {
  normalizedBaseUrl: string;
  hostCredentialEnv?: Record<string, string>;
}): AgentCredentialInjection {
  return {
    env: {
      ...(input.hostCredentialEnv ?? {}),
      ANTHROPIC_BASE_URL: input.normalizedBaseUrl,
    },
    applied: true,
    brokerProfile: 'external',
  };
}
