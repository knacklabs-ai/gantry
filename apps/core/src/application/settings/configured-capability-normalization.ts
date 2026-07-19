import type { SkillCatalogItem } from '../../domain/skills/skills.js';
import type { ToolCatalogItem } from '../../domain/tools/tools.js';
import { skillActionSemanticCapability } from '../../domain/skills/skill-action-permissions.js';
import {
  semanticCapabilityFromToolCatalogItem,
  type SemanticCapabilityDefinition,
} from '../../shared/semantic-capabilities.js';

export function skillActionDefinitionsForSkills(
  skills: readonly SkillCatalogItem[],
): SemanticCapabilityDefinition[] {
  return skills.flatMap((skill) =>
    (skill.actionPermissions ?? []).map((action) =>
      skillActionSemanticCapability({
        skillId: String(skill.id),
        skillName: skill.name,
        action,
      }),
    ),
  );
}

export function semanticCapabilityDefinitionsById(
  definitions: readonly SemanticCapabilityDefinition[],
): Record<string, SemanticCapabilityDefinition> {
  return Object.fromEntries(
    definitions.map((definition) => [definition.capabilityId, definition]),
  );
}

export function semanticCapabilityDefinitionsFromCatalogTools(
  tools: readonly ToolCatalogItem[],
): Record<string, SemanticCapabilityDefinition> {
  const definitions: Record<string, SemanticCapabilityDefinition> = {};
  for (const tool of tools) {
    if (tool.status !== 'active' || !tool.selectable) continue;
    const definition = semanticCapabilityFromToolCatalogItem({
      name: tool.name,
      inputSchema: tool.inputSchema,
    });
    if (!definition) continue;
    definitions[definition.capabilityId] = definition;
  }
  return definitions;
}
