import {
  formatInlineAgentWorkerOnlyConfigError,
  inlineAgentSkillEngineConstraintError,
  inlineWorkerOnlyToolRuleLabels,
  isInlineWorkerOnlyToolRule,
  type AgentRuntime,
} from '../../shared/agent-runtime.js';
import { deriveAgentEngineForProvider } from '../../shared/model-execution-route.js';
import {
  resolveModelSelectionForWorkloadWithFamilies,
  type FamilyOrderOverrides,
} from '../../shared/model-families.js';
import { DEFAULT_SETUP_MODEL_ALIAS } from '../../shared/model-catalog.js';
import { settingsCapabilityIdToToolRule } from './configured-capability-normalization.js';
import type {
  AgentEffort,
  RuntimeConfiguredAgent,
} from './runtime-settings-types.js';

const AGENT_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export {
  formatInlineAgentWorkerOnlyConfigError,
  inlineWorkerOnlyToolRuleLabels,
};

export function parseAgentRuntimeValue(
  raw: unknown,
  pathPrefix: string,
): AgentRuntime {
  if (raw === undefined) return 'worker';
  if (raw === 'worker' || raw === 'inline') return raw;
  throw new Error(`${pathPrefix} must be worker or inline`);
}

export function parseAgentMaxTurnsValue(
  raw: unknown,
  pathPrefix: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new Error(`${pathPrefix} must be a positive integer`);
  }
  return raw;
}

export function parseAgentEffortValue(
  raw: unknown,
  pathPrefix: string,
): AgentEffort | undefined {
  if (raw === undefined) return undefined;
  if (!AGENT_EFFORT_VALUES.includes(raw as AgentEffort)) {
    throw new Error(
      `${pathPrefix} must be one of ${AGENT_EFFORT_VALUES.join(', ')}`,
    );
  }
  return raw as AgentEffort;
}

export function resolveConfiguredAgentRuntime(
  agent: Pick<RuntimeConfiguredAgent, 'runtime'> | undefined,
): AgentRuntime {
  return agent?.runtime ?? 'worker';
}

export function inlineWorkerOnlyConfiguredCapabilityLabels(input: {
  agent: RuntimeConfiguredAgent;
  stdioMcpServerIds?: ReadonlySet<string>;
}): string[] {
  if (resolveConfiguredAgentRuntime(input.agent) !== 'inline') return [];
  const labels = new Set<string>();
  for (const source of input.agent.sources.tools) {
    if (source.kind === 'local_cli') labels.add(source.id);
  }
  for (const source of input.agent.sources.mcpServers) {
    if (input.stdioMcpServerIds?.has(source.id)) labels.add(source.id);
  }
  for (const capability of input.agent.capabilities) {
    const rule = settingsCapabilityIdToToolRule(capability.id);
    if (isInlineWorkerOnlyToolRule(rule)) labels.add(capability.id);
  }
  return [...labels].sort();
}

export function inlineConfiguredSkillEngineConstraintError(input: {
  subject: string;
  agent: RuntimeConfiguredAgent;
  defaultModel?: string;
  modelFamilyOrder?: FamilyOrderOverrides;
}): string | null {
  const effectiveModel =
    input.agent.model?.trim() ||
    input.defaultModel?.trim() ||
    DEFAULT_SETUP_MODEL_ALIAS;
  const resolved = resolveModelSelectionForWorkloadWithFamilies(
    effectiveModel,
    'chat',
    input.modelFamilyOrder,
  );
  if (!resolved.ok) return null;
  return inlineAgentSkillEngineConstraintError({
    subject: input.subject,
    agentRuntime: resolveConfiguredAgentRuntime(input.agent),
    agentEngine: deriveAgentEngineForProvider(resolved.entry.modelRoute.id),
    attachedSkillSourceIds: input.agent.sources.skills.map(
      (source) => source.id,
    ),
  });
}
