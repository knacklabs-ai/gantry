import {
  CALLABLE_AGENT_TOOL_PREFIX,
  type CallableAgentToolManifestEntry,
} from '../../application/core-tools/callable-agent-tools.js';
import {
  coreTaskLifecycleResultText,
  type CoreTaskLifecycleErrorCode,
  type CoreTaskLifecycleResult,
} from '../../application/core-tools/task-lifecycle.js';
import type {
  CoreToolDefinition,
  McpCompatibleToolError,
  McpCompatibleToolResult,
} from './contracts.js';
import type {
  CallableAgentToolInput,
  CoreToolInputSchema,
} from './schemas.js';

export function callableAgentToolName(
  entry: CallableAgentToolManifestEntry,
): string {
  return `${CALLABLE_AGENT_TOOL_PREFIX}${entry.toolName}`;
}

export function isCallableAgentToolName(name: string): boolean {
  return name.startsWith(CALLABLE_AGENT_TOOL_PREFIX);
}

export function createCallableAgentToolDefinitions(input: {
  manifest: readonly CallableAgentToolManifestEntry[];
  schema: CoreToolInputSchema<CallableAgentToolInput>;
  dispatch(
    entry: CallableAgentToolManifestEntry,
    args: Record<string, unknown>,
  ): Promise<CoreTaskLifecycleResult>;
}): CoreToolDefinition[] {
  return input.manifest.map((entry) => ({
    name: callableAgentToolName(entry),
    description: `Delegate to ${entry.displayName}.`,
    inputSchema: input.schema as CoreToolInputSchema<Record<string, unknown>>,
    handler: async (args) =>
      coreTaskLifecycleMcpResult(await input.dispatch(entry, args)),
  }));
}

export function coreTaskLifecycleMcpResult(
  result: CoreTaskLifecycleResult,
): McpCompatibleToolResult {
  const text = coreTaskLifecycleResultText(result);
  return {
    content: [{ type: 'text', text }],
    ...(result.ok
      ? {}
      : { isError: true, error: taskLifecycleError(result.code, text) }),
  };
}

function taskLifecycleError(
  code: CoreTaskLifecycleErrorCode | undefined,
  message: string,
): McpCompatibleToolError {
  switch (code) {
    case 'unavailable':
      return { category: 'transient', isRetryable: true, message };
    case 'invalid_request':
      return { category: 'validation', isRetryable: false, message };
    case 'forbidden':
      return { category: 'permission', isRetryable: false, message };
    case 'not_found':
    default:
      return { category: 'business', isRetryable: false, message };
  }
}
