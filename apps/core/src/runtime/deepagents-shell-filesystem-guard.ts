import { DEEPAGENTS_ENGINE, type AgentEngine } from '../shared/agent-engine.js';
import {
  isRunCommandToolRule,
  publicGantryToolNameForSdkTool,
  RUN_COMMAND_TOOL_NAME,
} from '../shared/gantry-tool-facades.js';
import {
  resolveRuntimeSecurityPosture,
  type RuntimeSecurityEnv,
} from '../shared/security-posture.js';
import type { RunnerSandboxProviderId } from '../shared/runner-sandbox-provider.js';

// Host-side, pre-spawn guards for DeepAgents runs that request shell (Bash /
// RunCommand) or SDK filesystem-tool authority. Raw DeepAgents `execute` and
// filesystem tools are disabled in v1 and only the future enablement path may
// route them through Gantry policy. Both guards are pure functions so the
// orderings and exact locked-plan copy are unit-testable without spawning a
// runner. See docs/architecture/deepagents-agent-engine-handoff-plan.md.

// Locked plan copy. The literals live here exactly once.
export const DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE =
  'DeepAgents shell execution is disabled until Gantry can route it through RunCommand policy.';
export const DEEPAGENTS_ENFORCING_SANDBOX_REQUIRED_MESSAGE =
  'DeepAgents requires an enforcing sandbox before shell or filesystem tools can be enabled in this deployment mode.';

// Gantry facade filesystem tools plus their provider-native source names; any of
// these in a resolved tool rule grants SDK filesystem authority. RunCommand /
// Bash shell authority is detected separately so the canonical Browser facade
// and pure web/search tools never trip the guard.
const FILESYSTEM_AUTHORITY_TOOL_NAMES = new Set<string>([
  'FileRead',
  'FileWrite',
  'FileEdit',
  'FileSearch',
]);

function ruleHeadName(rule: string): string {
  const trimmed = rule.trim();
  const open = trimmed.indexOf('(');
  const head = open >= 0 ? trimmed.slice(0, open) : trimmed;
  return head.trim();
}

// True when a single resolved tool-policy rule would grant shell execution
// (Bash or RunCommand, bare or scoped) for the run.
function ruleGrantsShellAuthority(rule: string): boolean {
  if (isRunCommandToolRule(rule)) return true;
  // Provider-native Bash maps to RunCommand; catch the raw alias too.
  return publicGantryToolNameForSdkTool(ruleHeadName(rule)).startsWith(
    RUN_COMMAND_TOOL_NAME,
  );
}

// True when a single resolved tool-policy rule would grant SDK filesystem-tool
// authority (Gantry FileRead/FileWrite/FileEdit/FileSearch or their raw
// provider-native source names such as Read/Write/Edit/MultiEdit/Glob/Grep).
function ruleGrantsFilesystemAuthority(rule: string): boolean {
  const head = ruleHeadName(rule);
  if (FILESYSTEM_AUTHORITY_TOOL_NAMES.has(head)) return true;
  return FILESYSTEM_AUTHORITY_TOOL_NAMES.has(
    publicGantryToolNameForSdkTool(head),
  );
}

// Whether any resolved tool-policy rule would enable shell or filesystem
// authority for the run. Exported so callers can short-circuit before invoking
// the guards (e.g. to skip work when no such authority is requested).
export function requestsShellOrFilesystemAuthority(
  toolPolicyRules: readonly string[] | undefined,
): boolean {
  return (toolPolicyRules ?? []).some(
    (rule) =>
      ruleGrantsShellAuthority(rule) || ruleGrantsFilesystemAuthority(rule),
  );
}

export interface DeepAgentsShellFilesystemGuardInput {
  engine: AgentEngine;
  toolPolicyRules: readonly string[] | undefined;
  securityEnv: RuntimeSecurityEnv;
  sandboxProvider: RunnerSandboxProviderId | undefined;
}

// v1 guard: raw DeepAgents shell/filesystem authority is unconditionally
// disabled. Returns the locked shell-execution copy when a DeepAgents run
// requests shell or filesystem authority, else null. Non-DeepAgents engines are
// never affected.
export function deepAgentsShellExecutionGuard(
  input: Pick<
    DeepAgentsShellFilesystemGuardInput,
    'engine' | 'toolPolicyRules'
  >,
): string | null {
  if (input.engine !== DEEPAGENTS_ENGINE) return null;
  if (!requestsShellOrFilesystemAuthority(input.toolPolicyRules)) return null;
  return DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE;
}

// Future-enablement guard: even once shell/filesystem authority is routed
// through Gantry policy, a DeepAgents run that enables it requires an enforcing
// sandbox when the deployment posture is production/remote OR the configured
// sandbox provider is not enforcing. Data-driven so the same function gates the
// later enablement path. Returns the locked enforcing-sandbox copy or null.
export function deepAgentsEnforcingSandboxGuard(
  input: DeepAgentsShellFilesystemGuardInput,
): string | null {
  if (input.engine !== DEEPAGENTS_ENGINE) return null;
  if (!requestsShellOrFilesystemAuthority(input.toolPolicyRules)) return null;
  const posture = resolveRuntimeSecurityPosture(input.securityEnv);
  const sandboxIsEnforcing = input.sandboxProvider === 'sandbox_runtime';
  if (posture.requiresEnforcingSandbox || !sandboxIsEnforcing) {
    return DEEPAGENTS_ENFORCING_SANDBOX_REQUIRED_MESSAGE;
  }
  return null;
}

// Combined pre-spawn entry point. v1 ordering: the shell-execution guard fires
// first and unconditionally blocks any DeepAgents shell/filesystem authority, so
// the enforcing-sandbox copy is reachable only on the future enablement path
// (when the first guard is lifted). Returns the first applicable locked message
// or null when the run is safe to spawn.
export function deepAgentsShellFilesystemGuard(
  input: DeepAgentsShellFilesystemGuardInput,
): string | null {
  return (
    deepAgentsShellExecutionGuard(input) ??
    deepAgentsEnforcingSandboxGuard(input)
  );
}
