import type { CredentialBrokerHealth } from '../../domain/models/credentials.js';
import type {
  RuntimeSecretProvider,
  RuntimeSecretRef,
} from '../../domain/ports/runtime-secret-provider.js';

export class EnvRuntimeSecretProvider implements RuntimeSecretProvider {
  constructor(private readonly source: NodeJS.ProcessEnv = process.env) {}

  getSecret(ref: RuntimeSecretRef): string {
    const value = this.getOptionalSecret(ref);
    if (!value) {
      throw new Error(`${ref.env} is required.`);
    }
    return value;
  }

  getOptionalSecret(ref: RuntimeSecretRef): string | undefined {
    const value = this.source[ref.env]?.trim();
    return value || undefined;
  }

  async healthCheck(
    refs: RuntimeSecretRef[] = [],
  ): Promise<CredentialBrokerHealth> {
    const missing = refs
      .filter((ref) => !this.getOptionalSecret(ref))
      .map((ref) => ref.env);
    if (missing.length > 0) {
      return {
        status: 'fail',
        message: 'Runtime-owned secrets are missing.',
        details: missing,
      };
    }
    return {
      status: 'pass',
      message: 'Runtime-owned secrets are configured.',
    };
  }
}
