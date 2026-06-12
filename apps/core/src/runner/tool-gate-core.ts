import {
  buildAgentToolExecutionRequest,
  ToolExecutionClassifier,
  ToolExecutionPolicyService,
  evaluateProtectedCapabilityToolUse,
  type ToolPolicyDecision,
} from '../shared/tool-execution-policy-service.js';
import { denyMemoryBoundaryToolUse } from './memory-boundary.js';

// Provider-neutral runner-side tool gate decision core. Holds the order-sensitive
// authority checks that every execution adapter shares:
//   1. protected-capability denial (settings/MCP/skill/provider config writes),
//   2. durable-memory-boundary denial (suppressed instruction-like memory +
//      high-risk command/secret/policy pattern),
//   3. locked-preset denial (agent runs with a provisioned-only access preset),
//   4. tool-execution policy evaluation (selected-capability / autonomous rules).
//
// The functions return provider-neutral verdicts (string deny reasons or a
// ToolPolicyDecision); each lane wraps them in its own provider-typed callback
// shape (an SDK permission callback, or LangChain DynamicTool wrappers). No
// provider SDK types are imported here — keep it that way so this stays reusable.

export const LOCKED_ACCESS_PRESET_DENY_REASON =
  'capability not provisioned: this agent runs with a locked access preset and cannot request new tools, skills, MCP servers, or permissions. Provision the capability before the run.';

export function denyProtectedCapabilityToolUse(
  toolName: string,
  input: unknown,
): string | null {
  const decision = evaluateProtectedCapabilityToolUse(toolName, input);
  if (!decision) return null;
  return `Denied by Gantry tool execution policy: ${decision.reason} ${decision.recoveryAction}`;
}

export interface NeutralToolGateContext {
  isScheduledJob?: boolean;
  jobId?: string;
  threadId?: string;
  conversationId: string;
}

export interface NeutralPreCheckInput {
  toolName: string;
  toolInput: unknown;
  memoryBlock: string;
}

// Runs the ordered authority pre-checks that may hard-deny before any
// policy evaluation or permission prompt. Returns the deny reason (already
// user-facing) or null to continue.
export function evaluateNeutralToolPreChecks(input: NeutralPreCheckInput): {
  decision: 'protected_capability' | 'memory_boundary';
  reason: string;
} | null {
  const protectedDenial = denyProtectedCapabilityToolUse(
    input.toolName,
    input.toolInput,
  );
  if (protectedDenial) {
    return { decision: 'protected_capability', reason: protectedDenial };
  }
  const memoryDenial = denyMemoryBoundaryToolUse(
    input.toolName,
    input.toolInput,
    {},
    input.memoryBlock,
  );
  if (memoryDenial) {
    return { decision: 'memory_boundary', reason: memoryDenial };
  }
  return null;
}

export function evaluateNeutralToolPolicy(input: {
  classifier: ToolExecutionClassifier;
  policy: ToolExecutionPolicyService;
  toolName: string;
  toolInput: unknown;
  context: NeutralToolGateContext;
  allowedToolRules: readonly string[];
  autonomousAllowedToolRules?: readonly string[];
}): ToolPolicyDecision {
  const request = buildAgentToolExecutionRequest(
    input.classifier,
    input.toolName,
    input.toolInput,
    input.context,
  );
  if (input.context.isScheduledJob) {
    return input.policy.evaluate({
      request,
      autonomousAllowedToolRules:
        input.autonomousAllowedToolRules ?? input.allowedToolRules,
    });
  }
  return input.policy.evaluate({
    request,
    allowedToolRules: input.allowedToolRules,
  });
}
