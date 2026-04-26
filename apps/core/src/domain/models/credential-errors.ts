export class CredentialBrokerPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialBrokerPolicyError';
  }
}

export class CredentialBrokerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialBrokerConfigError';
  }
}

export function isCredentialBrokerBoundaryError(
  err: unknown,
): err is CredentialBrokerPolicyError | CredentialBrokerConfigError {
  return (
    err instanceof CredentialBrokerPolicyError ||
    err instanceof CredentialBrokerConfigError ||
    (err instanceof Error &&
      (err.name === 'CredentialBrokerPolicyError' ||
        err.name === 'CredentialBrokerConfigError'))
  );
}
