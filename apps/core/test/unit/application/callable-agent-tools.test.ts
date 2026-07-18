import { describe, expect, it, vi } from 'vitest';

import {
  CALLABLE_AGENT_TOOL_PREFIX,
  dispatchCallableAgentTool,
  projectCallableAgentTools,
} from '@core/application/core-tools/callable-agent-tools.js';
import type { Agent } from '@core/domain/agent/agent.js';
import type { CoreTaskLifecycleBackend } from '@core/application/core-tools/task-lifecycle.js';

function agent(
  id: string,
  options: Partial<Pick<Agent, 'appId' | 'name' | 'status'>> = {},
): Agent {
  return {
    id,
    appId: options.appId ?? 'default',
    name: options.name ?? id,
    status: options.status ?? 'active',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } as Agent;
}

function backend(): CoreTaskLifecycleBackend {
  return {
    delegate_task: vi.fn(async () => ({ ok: true, message: 'queued' })),
    task_get: vi.fn(),
    task_list: vi.fn(),
    task_cancel: vi.fn(),
    task_message: vi.fn(),
  } as CoreTaskLifecycleBackend;
}

describe('callable agent tools', () => {
  it('projects only active same-app non-self allowlisted agents', () => {
    const projected = projectCallableAgentTools({
      agents: [
        agent('agent:main_agent'),
        agent('agent:reviewer', { name: 'Review\nAgent' }),
        agent('agent:disabled', { status: 'disabled' }),
        agent('agent:other-app', { appId: 'other' }),
        agent('agent:unlisted'),
      ],
      callerAppId: 'default',
      callerAgentId: 'agent:main_agent',
      callerFolder: 'main_agent',
      delegates: [
        'reviewer',
        'agent:reviewer',
        'disabled',
        'other-app',
        'main_agent',
      ],
      toolPolicyRules: ['AgentDelegation'],
    });

    expect(projected).toEqual([
      expect.objectContaining({
        targetAgentId: 'agent:reviewer',
        displayName: 'Review Agent',
      }),
    ]);
  });

  it('uses bounded collision-safe names derived from immutable identity', () => {
    const projected = projectCallableAgentTools({
      agents: [agent('agent:same-name-a'), agent('agent:same-name-b')],
      callerAppId: 'default',
      callerAgentId: 'agent:main_agent',
      callerFolder: 'main_agent',
      delegates: ['same-name-a', 'same-name-b'],
      toolPolicyRules: ['AgentDelegation'],
    });

    expect(new Set(projected.map(({ toolName }) => toolName)).size).toBe(2);
    expect(
      projected.every(
        ({ toolName }) =>
          `${CALLABLE_AGENT_TOOL_PREFIX}${toolName}`.length <= 64,
      ),
    ).toBe(true);
  });

  it.each([
    { parentTaskId: 'task-parent', toolPolicyRules: ['AgentDelegation'] },
    { parentTaskId: undefined, toolPolicyRules: [] },
  ])('suppresses projection without top-level delegation authority', (run) => {
    expect(
      projectCallableAgentTools({
        agents: [agent('agent:reviewer')],
        callerAppId: 'default',
        callerAgentId: 'agent:main_agent',
        callerFolder: 'main_agent',
        delegates: ['reviewer'],
        ...run,
      }),
    ).toEqual([]);
  });

  it('injects the pinned target after current eligibility revalidation', async () => {
    const taskBackend = backend();
    const entry = {
      toolName: 'reviewer_hash',
      targetAgentId: 'agent:reviewer',
      displayName: 'Reviewer',
    };

    await expect(
      dispatchCallableAgentTool({
        args: { objective: 'Review this', timeoutMs: 1234 },
        entry,
        backend: taskBackend,
        revalidate: vi.fn(async () => true),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(taskBackend.delegate_task).toHaveBeenCalledWith({
      objective: 'Review this',
      timeoutMs: 1234,
      syncWaitTimeoutMs: 60_000,
      targetAgentId: 'agent:reviewer',
    });
  });

  it('rejects target overrides and stale target eligibility', async () => {
    const taskBackend = backend();
    const entry = {
      toolName: 'reviewer_hash',
      targetAgentId: 'agent:reviewer',
      displayName: 'Reviewer',
    };

    await expect(
      dispatchCallableAgentTool({
        args: {
          objective: 'Review this',
          targetAgentId: 'agent:attacker',
        },
        entry,
        backend: taskBackend,
        revalidate: vi.fn(async () => true),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_request' });
    await expect(
      dispatchCallableAgentTool({
        args: { objective: 'Review this' },
        entry,
        backend: taskBackend,
        revalidate: vi.fn(async () => false),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'forbidden' });
    expect(taskBackend.delegate_task).not.toHaveBeenCalled();
  });
});
