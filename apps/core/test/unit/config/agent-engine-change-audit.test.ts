import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  diffAgentEngineChanges,
  diffMemoryEngineChange,
} from '@core/config/settings/agent-engine-change-audit.js';
import {
  DEEPAGENTS_ENGINE,
  DEFAULT_AGENT_ENGINE,
} from '@core/shared/agent-engine.js';
import type { RuntimeSettings } from '@core/config/settings/runtime-settings-types.js';

function settings(input: {
  defaultEngine?: string;
  memoryEngine?: string;
  agents: Record<string, { agentEngine?: string }>;
}): RuntimeSettings {
  const agents: Record<string, unknown> = {};
  for (const [folder, cfg] of Object.entries(input.agents)) {
    agents[folder] = {
      name: folder,
      folder,
      bindings: {},
      sources: { skills: [], mcpServers: [], tools: [] },
      capabilities: [],
      accessPreset: 'full',
      ...(cfg.agentEngine ? { agentEngine: cfg.agentEngine } : {}),
    };
  }
  return {
    agent: { defaultAgentEngine: input.defaultEngine ?? DEFAULT_AGENT_ENGINE },
    agents,
    memory: { engine: input.memoryEngine ?? DEFAULT_AGENT_ENGINE },
  } as unknown as RuntimeSettings;
}

describe('diffAgentEngineChanges', () => {
  it('reports a per-agent override flip', () => {
    const prev = settings({ agents: { a: {} } });
    const next = settings({
      agents: { a: { agentEngine: DEEPAGENTS_ENGINE } },
    });
    expect(diffAgentEngineChanges(prev, next)).toEqual([
      {
        agentFolder: 'a',
        oldEngine: DEFAULT_AGENT_ENGINE,
        newEngine: DEEPAGENTS_ENGINE,
      },
    ]);
  });

  it('reports inheriting agents when the default engine flips', () => {
    const prev = settings({
      defaultEngine: DEFAULT_AGENT_ENGINE,
      agents: { a: {}, b: { agentEngine: DEEPAGENTS_ENGINE } },
    });
    const next = settings({
      defaultEngine: DEEPAGENTS_ENGINE,
      agents: { a: {}, b: { agentEngine: DEEPAGENTS_ENGINE } },
    });
    // 'a' inherits the default (changes); 'b' has an explicit override (stable).
    expect(diffAgentEngineChanges(prev, next)).toEqual([
      {
        agentFolder: 'a',
        oldEngine: DEFAULT_AGENT_ENGINE,
        newEngine: DEEPAGENTS_ENGINE,
      },
    ]);
  });

  it('returns nothing when no effective engine changes', () => {
    const same = settings({
      agents: { a: { agentEngine: DEEPAGENTS_ENGINE } },
    });
    expect(diffAgentEngineChanges(same, same)).toEqual([]);
  });

  it('ignores newly added agents (no prior engine to diff)', () => {
    const prev = settings({ agents: { a: {} } });
    const next = settings({
      agents: { a: {}, b: { agentEngine: DEEPAGENTS_ENGINE } },
    });
    expect(diffAgentEngineChanges(prev, next)).toEqual([]);
  });

  it('returns nothing when previous settings are absent', () => {
    const next = settings({
      agents: { a: { agentEngine: DEEPAGENTS_ENGINE } },
    });
    expect(diffAgentEngineChanges(undefined, next)).toEqual([]);
  });
});

describe('diffMemoryEngineChange', () => {
  it('reports a memory engine flip', () => {
    const prev = settings({ memoryEngine: DEFAULT_AGENT_ENGINE, agents: {} });
    const next = settings({ memoryEngine: DEEPAGENTS_ENGINE, agents: {} });
    expect(diffMemoryEngineChange(prev, next)).toEqual({
      oldEngine: DEFAULT_AGENT_ENGINE,
      newEngine: DEEPAGENTS_ENGINE,
    });
  });

  it('returns undefined when the memory engine is unchanged', () => {
    const same = settings({ memoryEngine: DEEPAGENTS_ENGINE, agents: {} });
    expect(diffMemoryEngineChange(same, same)).toBeUndefined();
  });

  it('returns undefined when previous settings are absent', () => {
    const next = settings({ memoryEngine: DEEPAGENTS_ENGINE, agents: {} });
    expect(diffMemoryEngineChange(undefined, next)).toBeUndefined();
  });
});

describe('applyRuntimeSettingsDesiredState engine-change audit emission', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('@core/config/settings/runtime-settings.js');
    vi.doUnmock('@core/config/settings/runtime-settings-validation.js');
    vi.doUnmock('@core/config/settings/configured-capability-normalization.js');
    vi.doUnmock('@core/config/settings/desired-state-service.js');
  });

  it('emits one AGENT_ENGINE_CHANGED publish per changed agent after a successful reconcile', async () => {
    const prev = settings({ agents: { a: {} } });
    const next = settings({
      agents: { a: { agentEngine: DEEPAGENTS_ENGINE } },
    });

    vi.doMock('@core/config/settings/runtime-settings.js', () => ({
      saveRuntimeSettings: vi.fn(),
      loadRuntimeSettings: vi.fn(() => prev),
    }));
    vi.doMock('@core/config/settings/runtime-settings-validation.js', () => ({
      validateLoadedRuntimeSettings: vi.fn(() => ({ ok: true })),
    }));
    vi.doMock(
      '@core/config/settings/configured-capability-normalization.js',
      () => ({
        normalizeConfiguredCapabilitiesInSettings: vi.fn(async () => ({
          settings: next,
          changed: false,
        })),
      }),
    );
    vi.doMock('@core/config/settings/desired-state-service.js', () => ({
      SettingsDesiredStateService: class {
        async reconcile() {
          return { invalidReferences: [] };
        }
      },
    }));

    const { applyRuntimeSettingsDesiredState } =
      await import('@core/config/settings/restart-sync.js');

    const published: unknown[] = [];
    await applyRuntimeSettingsDesiredState({
      runtimeHome: '/tmp/gantry-engine-audit',
      settings: next,
      previousSettings: prev,
      ops: {} as never,
      repositories: {} as never,
      engineChangeAudit: {
        appId: 'default' as never,
        actor: 'control-api',
        publish: (input) => {
          published.push(input);
        },
      },
    });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      actor: 'control-api',
      change: {
        agentFolder: 'a',
        oldEngine: DEFAULT_AGENT_ENGINE,
        newEngine: DEEPAGENTS_ENGINE,
      },
    });
  });

  it('does not emit when no engine changed', async () => {
    const same = settings({
      agents: { a: { agentEngine: DEEPAGENTS_ENGINE } },
    });

    vi.doMock('@core/config/settings/runtime-settings.js', () => ({
      saveRuntimeSettings: vi.fn(),
      loadRuntimeSettings: vi.fn(() => same),
    }));
    vi.doMock('@core/config/settings/runtime-settings-validation.js', () => ({
      validateLoadedRuntimeSettings: vi.fn(() => ({ ok: true })),
    }));
    vi.doMock(
      '@core/config/settings/configured-capability-normalization.js',
      () => ({
        normalizeConfiguredCapabilitiesInSettings: vi.fn(async () => ({
          settings: same,
          changed: false,
        })),
      }),
    );
    vi.doMock('@core/config/settings/desired-state-service.js', () => ({
      SettingsDesiredStateService: class {
        async reconcile() {
          return { invalidReferences: [] };
        }
      },
    }));

    const { applyRuntimeSettingsDesiredState } =
      await import('@core/config/settings/restart-sync.js');

    const publish = vi.fn();
    await applyRuntimeSettingsDesiredState({
      runtimeHome: '/tmp/gantry-engine-audit',
      settings: same,
      previousSettings: same,
      ops: {} as never,
      repositories: {} as never,
      engineChangeAudit: { publish },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('emits one MEMORY_ENGINE_CHANGED publish when the memory engine flips', async () => {
    const prev = settings({ memoryEngine: DEFAULT_AGENT_ENGINE, agents: {} });
    const next = settings({ memoryEngine: DEEPAGENTS_ENGINE, agents: {} });

    vi.doMock('@core/config/settings/runtime-settings.js', () => ({
      saveRuntimeSettings: vi.fn(),
      loadRuntimeSettings: vi.fn(() => prev),
    }));
    vi.doMock('@core/config/settings/runtime-settings-validation.js', () => ({
      validateLoadedRuntimeSettings: vi.fn(() => ({ ok: true })),
    }));
    vi.doMock(
      '@core/config/settings/configured-capability-normalization.js',
      () => ({
        normalizeConfiguredCapabilitiesInSettings: vi.fn(async () => ({
          settings: next,
          changed: false,
        })),
      }),
    );
    vi.doMock('@core/config/settings/desired-state-service.js', () => ({
      SettingsDesiredStateService: class {
        async reconcile() {
          return { invalidReferences: [] };
        }
      },
    }));

    const { applyRuntimeSettingsDesiredState } =
      await import('@core/config/settings/restart-sync.js');

    const memoryPublished: unknown[] = [];
    await applyRuntimeSettingsDesiredState({
      runtimeHome: '/tmp/gantry-memory-engine-audit',
      settings: next,
      previousSettings: prev,
      ops: {} as never,
      repositories: {} as never,
      memoryEngineChangeAudit: {
        appId: 'default' as never,
        actor: 'settings-desired-state',
        publish: (input) => {
          memoryPublished.push(input);
        },
      },
    });

    expect(memoryPublished).toHaveLength(1);
    expect(memoryPublished[0]).toMatchObject({
      actor: 'settings-desired-state',
      change: {
        oldEngine: DEFAULT_AGENT_ENGINE,
        newEngine: DEEPAGENTS_ENGINE,
      },
    });
  });
});
