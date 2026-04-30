function readAssertedAppId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const assertedAppId = value.trim();
  return assertedAppId ? assertedAppId : null;
}

export function resolveAppScopeAppId(input: {
  apiKeyAppId: string;
  assertedAppId: string | null | undefined;
}): string | null {
  const assertedAppId = readAssertedAppId(input.assertedAppId);
  if (!assertedAppId) return input.apiKeyAppId;
  return assertedAppId === input.apiKeyAppId ? input.apiKeyAppId : null;
}
