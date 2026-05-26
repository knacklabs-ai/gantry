import type { GroupProcessingDeps } from './group-processing-types.js';
import {
  resolveConfiguredToolPolicy,
  type ConfiguredAgentToolPolicy,
} from './configured-agent-tools.js';
import { authorizedMcpServerIdsForAgent } from '../application/mcp/mcp-authorized-servers.js';
import { selectedSkillDisplay } from '../domain/skills/skill-identity.js';

export function memoryScopeForConversationKind(
  conversationKind?: string,
): 'user' | 'group' {
  return conversationKind === 'dm' ? 'user' : 'group';
}

export async function resolveTurnToolPolicy(
  deps: Pick<GroupProcessingDeps, 'getToolRepository' | 'getSkillRepository'>,
  turnContext?: { appId: string; agentId: string } | null,
): Promise<ConfiguredAgentToolPolicy> {
  if (!turnContext) {
    return {
      allowedTools: undefined,
      runtimeAccess: [],
    };
  }
  return resolveConfiguredToolPolicy({
    repository: deps.getToolRepository?.(),
    skillRepository: deps.getSkillRepository?.(),
    appId: turnContext.appId,
    agentId: turnContext.agentId,
  });
}

export async function resolveTurnSelectedSkillIds(
  deps: Pick<GroupProcessingDeps, 'getSkillRepository'>,
  turnContext?: { appId: string; agentId: string } | null,
): Promise<string[] | undefined> {
  return (await resolveTurnSelectedSkillContext(deps, turnContext)).ids;
}

export async function resolveTurnSelectedSkillContext(
  deps: Pick<GroupProcessingDeps, 'getSkillRepository'>,
  turnContext?: { appId: string; agentId: string } | null,
): Promise<{ ids?: string[]; displays?: string[] }> {
  const repository = deps.getSkillRepository?.();
  if (!turnContext || !repository) return {};
  const bindings = await repository.listAgentSkillBindings({
    appId: turnContext.appId as never,
    agentId: turnContext.agentId as never,
  });
  const activeBindings = bindings
    .filter((binding) => binding.status === 'active')
    .sort((left, right) =>
      String(left.skillId).localeCompare(String(right.skillId)),
    );
  const skillRows = await Promise.all(
    activeBindings.map((binding) => repository.getSkill(binding.skillId)),
  );
  return {
    ids: activeBindings.map((binding) => String(binding.skillId)),
    displays: activeBindings.map((binding, index) => {
      const skill = skillRows[index];
      return skill ? selectedSkillDisplay(skill) : String(binding.skillId);
    }),
  };
}

export async function resolveTurnSelectedMcpServerIds(
  deps: Pick<
    GroupProcessingDeps,
    'getMcpServerRepository' | 'getToolRepository' | 'getSkillRepository'
  >,
  turnContext?: { appId: string; agentId: string } | null,
  allowedTools?: readonly string[],
): Promise<string[] | undefined> {
  const mcpServers = deps.getMcpServerRepository?.();
  const tools = deps.getToolRepository?.();
  if (!turnContext || !mcpServers || !tools) return undefined;
  return authorizedMcpServerIdsForAgent({
    mcpServers,
    tools,
    skills: deps.getSkillRepository?.(),
    appId: turnContext.appId,
    agentId: turnContext.agentId,
    allowedTools,
  });
}
