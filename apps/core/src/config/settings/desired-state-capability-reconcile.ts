import type { AgentId } from '../../domain/agent/agent.js';
import type { AppId } from '../../domain/app/app.js';
import type { SettingsDesiredStateRepositories } from './desired-state-service.js';
import type { RuntimeConfiguredAgentCapabilities } from './runtime-settings-types.js';
import { ensureAgentToolCatalogItem } from '../../domain/tools/agent-tool-catalog-references.js';

export async function replaceDesiredStateCapabilities(input: {
  appId: AppId;
  agentId: AgentId;
  capabilities: RuntimeConfiguredAgentCapabilities;
  repositories: SettingsDesiredStateRepositories;
  now: string;
}): Promise<void> {
  const skillIds = [...new Set(input.capabilities.skillIds)];
  const mcpServersById = await getApprovedMcpServersById(input);
  const toolIds = await toolIdsForReplacement(input);
  await input.repositories.agents.replaceAgentCapabilityBindings({
    appId: input.appId,
    agentId: input.agentId,
    toolBindings: toolIds.map((toolId) => ({
      id: `agent-tool-binding:${input.agentId}:${toolId}` as never,
      appId: input.appId,
      agentId: input.agentId,
      toolId: toolId as never,
      status: 'active' as const,
      createdAt: input.now,
      updatedAt: input.now,
    })),
    skillBindings: skillIds.map((skillId) => ({
      id: `agent-skill-binding:${input.agentId}:${skillId}` as never,
      appId: input.appId,
      agentId: input.agentId,
      skillId: skillId as never,
      status: 'active' as const,
      createdAt: input.now,
      updatedAt: input.now,
    })),
    mcpBindings: input.capabilities.mcpServerIds.map((serverId) => {
      const server = mcpServersById.get(serverId);
      return {
        id: `agent-mcp-binding:${input.agentId}:${serverId}` as never,
        appId: input.appId,
        agentId: input.agentId,
        serverId: serverId as never,
        versionId: server!.latestApprovedVersionId! as never,
        status: 'active' as const,
        required: false,
        permissionPolicyIds: [],
        createdAt: input.now,
        updatedAt: input.now,
      };
    }),
    updatedAt: input.now,
  });
}

async function toolIdsForReplacement(input: {
  appId: AppId;
  capabilities: RuntimeConfiguredAgentCapabilities;
  repositories: SettingsDesiredStateRepositories;
  now: string;
}): Promise<string[]> {
  const ids = await Promise.all(
    [...new Set(input.capabilities.toolIds)].map(async (reference) => {
      const tool = await ensureAgentToolCatalogItem({
        repository: input.repositories.tools,
        appId: input.appId,
        reference,
        now: input.now,
      });
      return String(tool.id);
    }),
  );
  return ids;
}

async function getApprovedMcpServersById(input: {
  capabilities: RuntimeConfiguredAgentCapabilities;
  repositories: SettingsDesiredStateRepositories;
}): Promise<Map<string, { latestApprovedVersionId?: string }>> {
  const servers = await Promise.all(
    [...new Set(input.capabilities.mcpServerIds)].map(
      async (serverId) =>
        [
          serverId,
          await input.repositories.mcpServers.getServer(serverId as never),
        ] as const,
    ),
  );
  return new Map(
    servers
      .filter(([, server]) => server)
      .map(([serverId, server]) => [
        serverId,
        { latestApprovedVersionId: server!.latestApprovedVersionId },
      ]),
  );
}
