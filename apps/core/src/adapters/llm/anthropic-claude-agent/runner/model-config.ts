import type {
  EffortLevel,
  ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk';
import {
  findModelByRunnerModel,
  resolveRunnerModel,
} from '../../../../shared/model-catalog.js';
import type { AgentRunnerInput } from './types.js';

const GANTRY_EFFECTIVE_MODEL_SOURCE_ENV = 'GANTRY_EFFECTIVE_MODEL_SOURCE';
const DEFAULT_THINKING_DISPLAY = 'omitted' as const;
// Anthropic API minimum for thinking.budget_tokens.
const MIN_THINKING_BUDGET_TOKENS = 1024;

function normalizeModelValue(value?: string): string | undefined {
  const aliasModel = resolveRunnerModel(value);
  if (aliasModel) return aliasModel;
  if (process.env[GANTRY_EFFECTIVE_MODEL_SOURCE_ENV] === 'runtime') {
    return findModelByRunnerModel(value)?.runnerModel;
  }
  return undefined;
}

export function resolveConfiguredModel(): {
  model?: string;
  source: 'ANTHROPIC_MODEL' | 'unset';
} {
  const configuredModel = normalizeModelValue(process.env.ANTHROPIC_MODEL);
  if (configuredModel) {
    return { model: configuredModel, source: 'ANTHROPIC_MODEL' };
  }
  return { source: 'unset' };
}

export function resolveThinkingOptions(
  thinkingOverride?: AgentRunnerInput['thinking'],
): {
  thinking?: ThinkingConfig;
  effort?: EffortLevel;
  description: string;
} {
  if (!thinkingOverride) {
    return {
      thinking: { type: 'adaptive', display: DEFAULT_THINKING_DISPLAY },
      effort: 'medium',
      description: 'adaptive (effort medium)',
    };
  }

  if (thinkingOverride.mode === 'disabled') {
    return {
      thinking: { type: 'disabled' },
      description: 'disabled',
    };
  }

  if (thinkingOverride.mode === 'enabled') {
    // The API rejects budgets below its minimum; an unvalidated override
    // would only fail later at request time. Invalid values fall back to
    // the SDK default budget instead of being passed through.
    const rawBudget = thinkingOverride.budgetTokens;
    const validBudget =
      typeof rawBudget === 'number' && Number.isFinite(rawBudget)
        ? Math.max(Math.floor(rawBudget), MIN_THINKING_BUDGET_TOKENS)
        : undefined;
    return {
      thinking: {
        type: 'enabled',
        budgetTokens: validBudget,
        display: thinkingOverride.display ?? DEFAULT_THINKING_DISPLAY,
      },
      description:
        typeof validBudget === 'number'
          ? `enabled (budget ${validBudget} tokens${
              validBudget !== rawBudget ? `, raised from ${rawBudget}` : ''
            })`
          : 'enabled',
    };
  }

  return {
    thinking: {
      type: 'adaptive',
      display: thinkingOverride.display ?? DEFAULT_THINKING_DISPLAY,
    },
    effort: thinkingOverride.effort,
    description: thinkingOverride.effort
      ? `adaptive (effort ${thinkingOverride.effort})`
      : 'adaptive',
  };
}
