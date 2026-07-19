import type { AppId } from '../../domain/app/app.js';
import type { AgentMcpServerBinding } from '../../domain/mcp/mcp-servers.js';
import type { ProviderAccount } from '../../domain/provider/provider.js';
import type { AgentSkillBinding } from '../../domain/skills/skills.js';
import type {
  AgentToolBinding,
  AgentToolSource,
} from '../../domain/tools/tools.js';
import {
  folderForAgentId,
  groupByAgentId,
} from './desired-state-service-helpers.js';
import type { SettingsDesiredStateServiceDeps } from '../../domain/ports/settings-desired-state.js';
import type {
  RuntimeConfiguredAgent,
  RuntimeConfiguredAgentCapability,
  RuntimeConfiguredAgentSources,
  RuntimeProviderAccountSettings,
  RuntimeProviderSettings,
  RuntimeSettings,
} from '../../shared/runtime-settings.js';
import { displayToolReference } from '../../shared/agent-tool-references.js';
import { normalizeConfiguredCapabilities } from '../../shared/configured-capabilities.js';
import {
  containsGeneratedRuntimeSkillPath,
  GENERATED_RUNTIME_SKILL_PATH_DURABLE_REJECTION_REASON,
} from '../../shared/generated-runtime-paths.js';
import { semanticCapabilityFromToolCatalogItem } from '../../shared/semantic-capabilities.js';

function activeSources(
  skillBindings: AgentSkillBinding[],
  mcpBindings: AgentMcpServerBinding[],
  skillCatalogById: Map<unknown, { name: string }>,
  toolSources: AgentToolSource[] = [],
): RuntimeConfiguredAgentSources {
  return {
    skills: skillBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => {
        const skillId = binding.skillId;
        const skill = skillCatalogById.get(skillId);
        return {
          ...(skill ? { name: skill.name } : {}),
          id: String(skillId),
        };
      }),
    mcpServers: mcpBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => ({
        id: String(binding.serverId),
        ...(binding.allowedToolPatterns?.length
          ? { tools: [...binding.allowedToolPatterns] }
          : {}),
      })),
    tools: toolSources
      .filter((source) => source.status === 'active')
      .map((source) => ({
        id: source.sourceId,
        kind: source.kind,
        ...(source.version && source.version !== source.kind
          ? { version: source.version }
          : {}),
      })),
  };
}

function readableActiveCapabilities(
  toolBindings: AgentToolBinding[],
  toolCatalogById: Map<unknown, { name: string; inputSchema?: unknown }>,
): RuntimeConfiguredAgentCapability[] {
  const rawCapabilities = toolBindings
    .filter((item) => item.status === 'active')
    .map((binding) => {
      const tool = toolCatalogById.get(binding.toolId);
      const reference = tool
        ? displayToolReference({ toolId: binding.toolId, tool })
        : String(binding.toolId).replace(/^tool:/, '');
      if (containsGeneratedRuntimeSkillPath(reference)) {
        throw new Error(GENERATED_RUNTIME_SKILL_PATH_DURABLE_REJECTION_REASON);
      }
      return capabilityFromToolReference(reference, tool);
    });
  return normalizeConfiguredCapabilities({
    capabilities: rawCapabilities,
  }).capabilities;
}

function capabilityFromToolReference(
  reference: string,
  tool?: { name: string; inputSchema?: unknown },
): RuntimeConfiguredAgentCapability {
  if (reference === 'Browser') return { id: 'browser.use', version: 'builtin' };
  if (reference.startsWith('capability:')) {
    const semanticCapability = tool
      ? semanticCapabilityFromToolCatalogItem({
          name: tool.name,
          inputSchema: tool.inputSchema,
        })
      : undefined;
    return {
      id: reference.slice('capability:'.length),
      version: semanticCapability?.version ?? 'catalog',
    };
  }
  return { id: reference, version: 'builtin' };
}

export async function exportCurrentDesiredState(input: {
  deps: SettingsDesiredStateServiceDeps;
  appId: AppId;
  settings: RuntimeSettings;
}): Promise<RuntimeSettings> {
  const { deps, appId, settings } = input;
  const agents: Record<string, RuntimeConfiguredAgent> = {};
  const providers: Record<string, RuntimeProviderSettings> = {};
  const providerAccounts: Record<string, RuntimeProviderAccountSettings> = {};
  const storedAgents = await deps.repositories.agents.listAgents(appId);
  const activeStoredAgents = storedAgents.filter(
    (agent) => agent.status === 'active',
  );
  const agentIds = activeStoredAgents.map((agent) => agent.id);
  const [
    toolBindingRows,
    toolSourceRows,
    skillBindingRows,
    mcpBindingRows,
    toolCatalogRows,
    skillCatalogRows,
    storedProviderAccounts,
  ] = await Promise.all([
    deps.repositories.tools.listAgentToolBindingsForAgents({ appId, agentIds }),
    deps.repositories.tools.listAgentToolSourcesForAgents
      ? deps.repositories.tools.listAgentToolSourcesForAgents({
          appId,
          agentIds,
        })
      : Promise.resolve([]),
    deps.repositories.skills.listAgentSkillBindingsForAgents({
      appId,
      agentIds,
    }),
    deps.repositories.mcpServers.listAgentBindingsForAgents({
      appId,
      agentIds,
      limitPerAgent: 500,
    }),
    deps.repositories.tools.listTools({ appId, statuses: ['active'] }),
    deps.repositories.skills.listSkills({ appId, statuses: ['installed'] }),
    deps.repositories.providerAccounts?.listProviderAccounts
      ? deps.repositories.providerAccounts.listProviderAccounts(appId)
      : Promise.resolve([]),
  ]);
  const toolBindingsByAgent = groupByAgentId(toolBindingRows);
  const toolSourcesByAgent = groupByAgentId(toolSourceRows);
  const skillBindingsByAgent = groupByAgentId(skillBindingRows);
  const mcpBindingsByAgent = groupByAgentId(mcpBindingRows);
  const toolCatalogById = new Map(
    toolCatalogRows.map((tool) => [tool.id, tool]),
  );
  const skillCatalogById = new Map(
    skillCatalogRows.map((skill) => [skill.id, skill]),
  );
  const referencedProviderAccountIds = new Set(
    Object.values(settings.conversations).flatMap((conversation) => [
      conversation.providerAccount,
      ...Object.values(conversation.installedAgents).map(
        (install) => install.providerAccountId,
      ),
    ]),
  );

  for (const account of storedProviderAccounts.filter(
    (candidate) =>
      (!isInternalAppControlProviderAccount(candidate) ||
        referencedProviderAccountIds.has(String(candidate.id))) &&
      !isCanonicalFallbackProviderAccount(candidate),
  )) {
    const providerId = String(account.providerId);
    const agentFolder =
      folderForAgentId(account.agentId) ?? String(account.agentId);
    const accountId = String(account.id);
    const storedSecretRefs = runtimeSecretRefsForAccount(account);
    providerAccounts[accountId] = {
      agentId: agentFolder,
      provider: providerId,
      label: account.label,
      status: account.status,
      runtimeSecretRefs: Object.keys(storedSecretRefs).length
        ? storedSecretRefs
        : (settings.providerAccounts[accountId]?.runtimeSecretRefs ?? {}),
      externalIdentityRef: account.externalIdentityRef,
      config: Object.fromEntries(
        Object.entries(account.config).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    };
    providers[providerId] = {
      enabled:
        providers[providerId]?.enabled === true || account.status === 'active',
    };
  }

  for (const accountId of referencedProviderAccountIds) {
    if (providerAccounts[accountId]) continue;
    const account = settings.providerAccounts[accountId];
    if (!account) continue;
    providerAccounts[accountId] = structuredClone(account);
    providers[account.provider] = {
      enabled:
        providers[account.provider]?.enabled === true ||
        account.status !== 'disabled',
    };
  }

  for (const agent of activeStoredAgents) {
    const folder = folderForAgentId(agent.id);
    if (!folder) continue;
    const existing = settings.agents[folder];
    agents[folder] = {
      name: agent.name,
      folder,
      persona: existing?.persona ?? 'developer',
      relationshipMode: existing?.relationshipMode ?? 'personal',
      model: existing?.model,
      agentHarness: existing?.agentHarness,
      permissionMode: existing?.permissionMode,
      runtime: existing?.runtime === 'inline' ? 'inline' : undefined,
      maxTurns: existing?.maxTurns,
      maxRunTokens: existing?.maxRunTokens,
      effort: existing?.effort,
      thinking: existing?.thinking,
      maxOutputTokens: existing?.maxOutputTokens,
      oneTimeJobDefaultModel: existing?.oneTimeJobDefaultModel,
      recurringJobDefaultModel: existing?.recurringJobDefaultModel,
      toolRules: existing?.toolRules,
      delegates: existing?.delegates ?? [],
      sources: activeSources(
        skillBindingsByAgent.get(agent.id) ?? [],
        mcpBindingsByAgent.get(agent.id) ?? [],
        skillCatalogById,
        toolSourcesByAgent.get(agent.id) ?? [],
      ),
      capabilities: readableActiveCapabilities(
        toolBindingsByAgent.get(agent.id) ?? [],
        toolCatalogById,
      ),
      accessPreset: existing?.accessPreset ?? 'full',
    };
  }

  return {
    ...settings,
    providers,
    providerAccounts,
    conversations: structuredClone(settings.conversations),
    agents,
  };
}

function isInternalAppControlProviderAccount(
  account: ProviderAccount,
): boolean {
  const providerId = String(account.providerId);
  return providerId === 'app' || providerId === 'control-http';
}

function isCanonicalFallbackProviderAccount(account: ProviderAccount): boolean {
  const accountId = String(account.id);
  return (
    accountId.startsWith('channel-providerAccount:') ||
    accountId.startsWith('channel-providerConnection:')
  );
}

function runtimeSecretRefsForAccount(
  account: ProviderAccount,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(account.runtimeSecretRefs).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
}
