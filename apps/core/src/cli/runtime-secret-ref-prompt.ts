import * as p from '@clack/prompts';

import {
  awsSecretsManagerRuntimeSecretRef,
  envRuntimeSecretRef,
  gantryRuntimeSecretRef,
} from '../domain/ports/runtime-secret-provider.js';
import { storeRuntimeSecretInput } from './credentials.js';

export interface RuntimeSecretInputPlan {
  ref: string;
  persist(): Promise<void>;
}

async function promptForValue(options: {
  message: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string | null> {
  const value = await p.text({
    message: options.message,
    defaultValue: options.defaultValue,
    validate: options.validate
      ? (value) => options.validate?.(value ?? '')
      : undefined,
  });
  if (typeof p.isCancel === 'function' && p.isCancel(value)) return null;
  return String(value).trim();
}

export async function planRuntimeSecretInput(input: {
  runtimeHome: string;
  name: string;
  value: string;
  actor: string;
  label?: string;
}): Promise<RuntimeSecretInputPlan | null> {
  const label = input.label ?? input.name;
  const source =
    typeof p.select === 'function'
      ? await p.select({
          message: `Where should Gantry resolve ${label}?`,
          options: [
            {
              value: 'gantry',
              label: 'Store in Gantry',
              hint: 'encrypted in runtime storage',
            },
            {
              value: 'aws-sm',
              label: 'Use AWS Secrets Manager',
              hint: 'save an aws-sm ref',
            },
            {
              value: 'env',
              label: 'Use environment variable',
              hint: 'save an env ref',
            },
          ],
          initialValue: 'gantry',
        })
      : 'gantry';
  if (typeof p.isCancel === 'function' && p.isCancel(source)) return null;
  if (source === 'env') {
    const envName = await promptForValue({
      message: `${label} environment variable`,
      defaultValue: input.name,
      validate: (value) =>
        value?.trim() ? undefined : 'Environment variable is required.',
    });
    if (envName === null) return null;
    return { ref: envRuntimeSecretRef(envName), persist: async () => {} };
  }
  if (source === 'aws-sm') {
    const secretName = await promptForValue({
      message: `${label} AWS Secrets Manager name or ARN`,
      defaultValue: input.name,
      validate: (value) =>
        value?.trim()
          ? undefined
          : 'AWS Secrets Manager reference is required.',
    });
    if (secretName === null) return null;
    return {
      ref: awsSecretsManagerRuntimeSecretRef(secretName),
      persist: async () => {},
    };
  }
  return {
    ref: gantryRuntimeSecretRef(input.name),
    persist: async () => {
      await storeRuntimeSecretInput({
        runtimeHome: input.runtimeHome,
        name: input.name,
        value: input.value,
        actor: input.actor,
      });
    },
  };
}
