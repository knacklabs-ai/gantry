import type {
  AgentCredentialBrokerBinding,
  AgentCredentialInjection,
  CredentialBrokerHealth,
  CredentialBrokerProfile,
} from '../models/credentials.js';

export interface AgentCredentialBrokerInput {
  binding: AgentCredentialBrokerBinding;
}

export interface AgentCredentialBrokerCapabilities {
  profile: CredentialBrokerProfile;
  supportsAgentBinding: boolean;
  returnsRawSecrets: false;
}

export interface AgentCredentialBroker {
  getInjection(
    input: AgentCredentialBrokerInput,
  ): Promise<AgentCredentialInjection>;
  healthCheck(
    input?: AgentCredentialBrokerInput,
  ): Promise<CredentialBrokerHealth>;
  getCapabilities(): AgentCredentialBrokerCapabilities;
}
