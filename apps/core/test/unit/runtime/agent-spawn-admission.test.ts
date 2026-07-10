import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_ENGINE,
  DEEPAGENTS_ENGINE,
} from '@core/shared/agent-engine.js';
import { validateAgentPreSpawnAdmission } from '@core/runtime/agent-spawn-admission.js';
import type { AgentInput } from '@core/runtime/agent-spawn-types.js';

const baseInput: AgentInput = {
  prompt: 'hello',
  workspaceFolder: 'main_agent',
  chatJid: 'app:conversation',
};

describe('agent spawn admission', () => {
  it('rejects inline pre-spawn admission with every worker-only capability named', () => {
    const error = validateAgentPreSpawnAdmission({
      agentRuntime: 'inline',
      agentEngine: DEEPAGENTS_ENGINE,
      sandboxProvider: 'direct',
      securityEnv: {},
      stdioMcpSourceIds: ['mcp:stdio-crm'],
      agentInput: {
        ...baseInput,
        attachedSkillSourceIds: ['skill:writer'],
        attachedMcpSourceIds: ['mcp:stdio-crm'],
        toolPolicyRules: ['RunCommand(npm test *)', 'FileWrite', 'Browser'],
        runtimeAccess: [
          {
            selectedCapabilityId: 'acme.local-cli.read',
            sourceType: 'local_cli',
            auditLabel: 'Acme CLI read',
            commandRules: ['RunCommand(/usr/local/bin/acme read *)'],
            credentialDirs: [],
            networkBindings: [],
          },
        ],
      },
    });

    expect(error).toBe(
      'agent.runtime inline is incompatible with worker-only capabilities: Browser, FileWrite, RunCommand(npm test *), acme.local-cli.read, mcp:stdio-crm',
    );
  });

  it('allows attached skills for inline DeepAgents admission', () => {
    expect(
      validateAgentPreSpawnAdmission({
        agentRuntime: 'inline',
        agentEngine: DEEPAGENTS_ENGINE,
        sandboxProvider: 'direct',
        securityEnv: {},
        agentInput: {
          ...baseInput,
          attachedSkillSourceIds: ['skill:writer'],
        },
      }),
    ).toBeNull();
  });

  it('rejects attached skills for inline default-engine admission', () => {
    expect(
      validateAgentPreSpawnAdmission({
        agentRuntime: 'inline',
        agentEngine: DEFAULT_AGENT_ENGINE,
        sandboxProvider: 'direct',
        securityEnv: {},
        agentInput: {
          ...baseInput,
          attachedSkillSourceIds: ['skill:writer'],
        },
      }),
    ).toBe(
      `agent.runtime inline supports attached skills only with engine ${DEEPAGENTS_ENGINE}; resolved engine ${DEFAULT_AGENT_ENGINE} is incompatible with attached skills: skill:writer`,
    );
  });

  it('allows worker pre-spawn admission with worker-only capabilities held', () => {
    expect(
      validateAgentPreSpawnAdmission({
        agentRuntime: 'worker',
        agentEngine: DEFAULT_AGENT_ENGINE,
        sandboxProvider: 'direct',
        securityEnv: {},
        agentInput: {
          ...baseInput,
          attachedSkillSourceIds: ['skill:writer'],
          toolPolicyRules: ['RunCommand(npm test *)'],
        },
      }),
    ).toBeNull();
  });
});
