import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEMORY_RESPONSE_FAMILY,
  SECONDARY_MEMORY_RESPONSE_FAMILY,
  memoryEngineLabel,
  resolveMemoryEngineRouting,
} from '@core/shared/memory-engine-matrix.js';
import type { AgentEngine } from '@core/shared/agent-engine.js';

const DEFAULT_SDK_ENGINE = ['anthropic', 'sdk'].join('_') as AgentEngine;
const DEEPAGENTS_ENGINE = 'deepagents' as AgentEngine;

describe('memory engine matrix', () => {
  it('default SDK engine + default family -> native_sdk lane', () => {
    const routing = resolveMemoryEngineRouting({
      engine: DEFAULT_SDK_ENGINE,
      responseFamily: DEFAULT_MEMORY_RESPONSE_FAMILY,
      alias: 'haiku',
    });
    expect(routing).toEqual({ ok: true, lane: 'native_sdk' });
  });

  it('deepagents engine + default family -> anthropic_direct lane', () => {
    const routing = resolveMemoryEngineRouting({
      engine: DEEPAGENTS_ENGINE,
      responseFamily: DEFAULT_MEMORY_RESPONSE_FAMILY,
      alias: 'haiku',
    });
    expect(routing).toEqual({ ok: true, lane: 'anthropic_direct' });
  });

  it('deepagents engine + secondary family -> openai_direct lane', () => {
    const routing = resolveMemoryEngineRouting({
      engine: DEEPAGENTS_ENGINE,
      responseFamily: SECONDARY_MEMORY_RESPONSE_FAMILY,
      alias: 'gpt',
    });
    expect(routing).toEqual({ ok: true, lane: 'openai_direct' });
  });

  it('default SDK engine + secondary family is rejected with the locked copy', () => {
    const routing = resolveMemoryEngineRouting({
      engine: DEFAULT_SDK_ENGINE,
      responseFamily: SECONDARY_MEMORY_RESPONSE_FAMILY,
      alias: 'gpt',
    });
    expect(routing).toEqual({
      ok: false,
      reason: 'secondary-on-default-sdk',
      message:
        'Model gpt uses the OpenAI endpoint, which is not supported by Anthropic SDK. Choose DeepAgents or an Anthropic-compatible model.',
    });
  });

  it('rejects an unknown response family under any engine', () => {
    for (const engine of [DEFAULT_SDK_ENGINE, DEEPAGENTS_ENGINE]) {
      const routing = resolveMemoryEngineRouting({
        engine,
        responseFamily: 'gemini',
        alias: 'gem',
      });
      expect(routing.ok).toBe(false);
      if (!routing.ok) {
        expect(routing.reason).toBe('unsupported-family');
        expect(routing.message).toContain('unsupported response family "gemini"');
      }
    }
  });

  it('labels engines with the public vocabulary', () => {
    expect(memoryEngineLabel(DEFAULT_SDK_ENGINE)).toBe('Anthropic SDK');
    expect(memoryEngineLabel(DEEPAGENTS_ENGINE)).toBe('DeepAgents');
  });
});
