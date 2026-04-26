import type { CredentialBrokerHealth } from '../models/credentials.js';

export interface RuntimeSecretRef {
  env: string;
}

export interface RuntimeSecretProvider {
  getSecret(ref: RuntimeSecretRef): string;
  getOptionalSecret(ref: RuntimeSecretRef): string | undefined;
  healthCheck?(refs?: RuntimeSecretRef[]): Promise<CredentialBrokerHealth>;
}
