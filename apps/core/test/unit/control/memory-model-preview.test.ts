import { describe, expect, it } from 'vitest';

import { memoryModelPreview } from '@core/control/server/routes/models.js';
import type {
  ControlModelDefaultSlot,
  ControlRouteContext,
} from '@core/control/server/handler-context.js';
import {
  resolveModelSelectionForWorkload,
  type ModelWorkload,
} from '@core/shared/model-catalog.js';
import {
  DEEPAGENTS_ENGINE,
  DEFAULT_AGENT_ENGINE,
  type AgentEngine,
} from '@core/shared/agent-engine.js';

function slotFor(alias: string, workload: ModelWorkload): ControlModelDefaultSlot {
  const resolved = resolveModelSelectionForWorkload(alias, workload);
  if (!resolved.ok) throw new Error(`fixture alias not resolvable: ${alias}`);
  return {
    configuredAlias: alias,
    effectiveAlias: resolved.alias,
    source: 'preset-managed',
    workload,
    modelEntry: resolved.entry,
  };
}

function ctxWith(engine: AgentEngine, extractorAlias: string): ControlRouteContext {
  const extractor = slotFor(extractorAlias, 'memory_extractor');
  return {
    getMemoryEngine: () => engine,
    getModelDefaults: () => ({
      defaults: {
        chat: extractor,
        oneTime: extractor,
        recurring: extractor,
        memoryExtractor: extractor,
        memoryDreaming: extractor,
        memoryConsolidation: extractor,
      },
    }),
  } as unknown as ControlRouteContext;
}

describe('memoryModelPreview', () => {
  it('shows the engine, family, and native_sdk lane for the default engine + anthropic model', () => {
    const result = memoryModelPreview(ctxWith(DEFAULT_AGENT_ENGINE, 'haiku'), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      target: 'memory',
      task: 'extractor',
      engine: DEFAULT_AGENT_ENGINE,
      engineLabel: 'Anthropic SDK',
      responseFamily: 'anthropic',
      diagnosticLane: 'native_sdk',
    });
    expect(result.body.incompatibility).toBeUndefined();
  });

  it('shows the openai_direct lane for deepagents + openai model', () => {
    const result = memoryModelPreview(ctxWith(DEEPAGENTS_ENGINE, 'gpt'), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      engine: DEEPAGENTS_ENGINE,
      engineLabel: 'DeepAgents',
      responseFamily: 'openai',
      diagnosticLane: 'openai_direct',
    });
  });

  it('surfaces the locked rejection copy for the default engine + openai model', () => {
    const result = memoryModelPreview(ctxWith(DEFAULT_AGENT_ENGINE, 'gpt'), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.diagnosticLane).toBeNull();
    expect(result.body.incompatibility).toBe(
      'Model gpt uses the OpenAI endpoint, which is not supported by Anthropic SDK. Choose DeepAgents or an Anthropic-compatible model.',
    );
  });
});
