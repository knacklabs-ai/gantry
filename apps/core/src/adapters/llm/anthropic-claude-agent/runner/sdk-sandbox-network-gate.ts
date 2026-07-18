import { evaluateEgressDenylist } from '../../../../shared/egress-policy.js';
import { isSdkSandboxNetworkAccessToolName } from '../../../../shared/agent-tool-references.js';

export function decideSdkSandboxNetworkAccess(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  denylist: readonly string[];
}):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt: false }
  | null {
  if (!isSdkSandboxNetworkAccessToolName(input.toolName)) return null;

  const host = input.toolInput.host;
  const deny = evaluateEgressDenylist({
    settings: { denylist: [...input.denylist] },
    host: typeof host === 'string' ? host : '',
  });
  if (deny) {
    return {
      behavior: 'deny',
      message: deny.reason,
      interrupt: false,
    };
  }

  return { behavior: 'allow', updatedInput: input.toolInput };
}
