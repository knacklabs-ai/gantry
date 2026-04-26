export type HostCredentialMode = 'none' | 'onecli' | 'external';

export function parseHostCredentialMode(
  raw: string | undefined,
): HostCredentialMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'none') return 'none';
  if (normalized === 'onecli') return 'onecli';
  if (normalized === 'external') return 'external';
  return undefined;
}

export function resolveHostCredentialMode(
  rawMode: string | undefined,
): HostCredentialMode {
  const parsed = parseHostCredentialMode(rawMode);
  if (parsed) return parsed;
  return 'onecli';
}
