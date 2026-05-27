import * as p from '@clack/prompts';

import type { HostCredentialMode } from '../config/credentials/mode.js';
import { listModelRouteProviders } from '../shared/model-provider-registry.js';

export interface CredentialSetupDraft {
  credentialMode: HostCredentialMode;
  postgresSetupKind?: 'local' | 'hosted' | 'existing';
}

export type CredentialStepAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'resume' }
  | { type: 'cancel' };

export async function verifyModelAccess(
  _url?: string,
): Promise<{ ok: boolean; message: string; nextAction?: string }> {
  return {
    ok: true,
    message:
      'Gantry Model Gateway credentials are stored in Postgres and validated during model preflight.',
  };
}

export async function runCredentialsStep(
  draft: CredentialSetupDraft,
): Promise<CredentialStepAction> {
  draft.credentialMode = 'gantry';
  const providers = listModelRouteProviders();
  const selectedProvider = await p.select({
    message: 'Model access provider',
    options: providers.map((provider) => ({
      value: provider.id,
      label: provider.label,
      hint: provider.supportedWorkloads.join(', '),
    })),
  });
  if (p.isCancel(selectedProvider)) return { type: 'cancel' };
  const provider = providers.find((item) => item.id === selectedProvider);
  if (!provider) return { type: 'cancel' };
  const selectedMode =
    provider.credentialModes.length === 1
      ? provider.credentialModes[0]!.id
      : await p.select({
          message: 'Credential auth mode',
          options: provider.credentialModes.map((mode) => ({
            value: mode.id,
            label: mode.label,
            hint: mode.helpText,
          })),
        });
  if (p.isCancel(selectedMode)) return { type: 'cancel' };
  p.note(
    [
      'Gantry Model Gateway gives agents brokered access to model providers.',
      `${provider.label} uses ${String(selectedMode)} model credentials.`,
      `Run \`gantry credentials model set ${provider.id}\` after setup to store the credential.`,
      'The agent runner receives a loopback gateway token, not raw provider keys.',
      'Channel, Postgres, and runtime-owned secrets still stay in runtime .env.',
    ].join('\n'),
    'Model Access',
  );
  return { type: 'next' };
}
