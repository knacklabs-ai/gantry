import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import type {
  RuntimeSecretProvider,
  RuntimeSecretRef,
} from '../../domain/ports/runtime-secret-provider.js';
import { runtimeSecretRefTarget } from '../../domain/ports/runtime-secret-provider.js';

export class AwsSecretsManagerRuntimeSecretProvider implements RuntimeSecretProvider {
  private client: SecretsManagerClient | undefined;

  constructor(
    private readonly fallback: RuntimeSecretProvider,
    private readonly region = process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION,
  ) {}

  getSecret(ref: RuntimeSecretRef): string {
    const value = this.getOptionalSecret(ref);
    if (!value) {
      throw new Error(`${runtimeSecretRefTarget(ref).name} is required.`);
    }
    return value;
  }

  getOptionalSecret(ref: RuntimeSecretRef): string | undefined {
    const target = runtimeSecretRefTarget(ref);
    if (target.source === 'env') return this.fallback.getOptionalSecret(ref);
    return undefined;
  }

  async getOptionalSecretAsync(
    ref: RuntimeSecretRef,
  ): Promise<string | undefined> {
    const target = runtimeSecretRefTarget(ref);
    if (target.source === 'env') {
      return (
        (await this.fallback.getOptionalSecretAsync?.(ref)) ??
        this.fallback.getOptionalSecret(ref)
      );
    }
    if (target.source !== 'aws-sm') return undefined;
    const result = await this.secretsManager().send(
      new GetSecretValueCommand({ SecretId: target.name }),
    );
    if (result.SecretString) return result.SecretString;
    return result.SecretBinary
      ? Buffer.from(result.SecretBinary).toString('utf8')
      : undefined;
  }

  private secretsManager(): SecretsManagerClient {
    return (this.client ??= new SecretsManagerClient({
      ...(this.region ? { region: this.region } : {}),
    }));
  }
}
