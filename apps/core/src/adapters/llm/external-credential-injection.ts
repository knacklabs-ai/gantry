import type { AgentCredentialInjection } from '../../domain/models/credentials.js';

export function createExternalAgentCredentialInjection(input: {
  normalizedBaseUrl: string;
}): AgentCredentialInjection {
  return {
    env: {
      ANTHROPIC_BASE_URL: input.normalizedBaseUrl,
    },
    applied: true,
    brokerProfile: 'external',
  };
}
