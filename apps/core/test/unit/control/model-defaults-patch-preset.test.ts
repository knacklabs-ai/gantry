import { describe, expect, it } from 'vitest';

import { providersSelectedByPatch } from '@core/control/server/routes/models.js';
import type {
  ControlModelDefaultSlot,
  ControlRouteContext,
} from '@core/control/server/handler-context.js';
import {
  resolveModelSelectionForWorkload,
  type ModelWorkload,
} from '@core/shared/model-catalog.js';

function slotFor(
  alias: string,
  workload: ModelWorkload,
): ControlModelDefaultSlot {
  const resolved = resolveModelSelectionForWorkload(alias, workload);
  if (!resolved.ok) throw new Error(`fixture alias not resolvable: ${alias}`);
  return {
    configuredAlias: alias,
    effectiveAlias: resolved.alias,
    source: 'provider-managed',
    workload,
    modelEntry: resolved.entry,
  };
}

function defaultsWith(
  chatAlias: string,
  memoryAlias: string,
): ReturnType<ControlRouteContext['getModelDefaults']> {
  const chat = slotFor(chatAlias, 'chat');
  const oneTime = slotFor(chatAlias, 'one_time_job');
  const recurring = slotFor(chatAlias, 'recurring_job');
  const memory = slotFor(memoryAlias, 'memory_extractor');
  return {
    defaults: {
      chat,
      oneTime,
      recurring,
      memoryExtractor: memory,
      memoryDreaming: memory,
      memoryConsolidation: memory,
    },
  } as unknown as ReturnType<ControlRouteContext['getModelDefaults']>;
}

describe('providersSelectedByPatch', () => {
  it('selects a DeepAgents provider when the body omits provider-managed memory', () => {
    const defaults = defaultsWith('groq', 'groq');
    expect(() => providersSelectedByPatch({}, defaults)).not.toThrow();
    expect(providersSelectedByPatch({}, defaults)).toEqual(['groq']);
  });

  it('selects the anthropic provider for an anthropic chat default', () => {
    const defaults = defaultsWith('sonnet', 'haiku');
    expect(providersSelectedByPatch({}, defaults)).toEqual(['anthropic']);
  });

  it('follows the patched chat alias for inherited job defaults', () => {
    const defaults = defaultsWith('sonnet', 'groq');
    const inheritedOneTime = slotFor('sonnet', 'one_time_job');
    const inheritedRecurring = slotFor('sonnet', 'recurring_job');
    inheritedOneTime.configuredAlias = null;
    inheritedRecurring.configuredAlias = null;
    defaults.defaults.oneTime = inheritedOneTime;
    defaults.defaults.recurring = inheritedRecurring;

    const selected = providersSelectedByPatch(
      { chat: 'groq', memory: 'reset' },
      defaults,
    );
    expect(selected).not.toContain('anthropic');
    expect(selected).toContain('groq');
  });
});
