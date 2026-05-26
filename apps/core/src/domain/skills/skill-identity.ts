import type { SkillCatalogItem } from './skills.js';
import { materializedSkillDirectoryNameFor } from './skills.js';

export function canonicalSkillReference(
  skill: Pick<SkillCatalogItem, 'id'>,
): string {
  return String(skill.id);
}

export function skillDisplayLabel(
  skill: Pick<SkillCatalogItem, 'name'>,
): string {
  return skill.name;
}

export function skillMaterializationKey(
  skill: Pick<SkillCatalogItem, 'name'>,
): string {
  return skillMaterializationKeyForName(skill.name);
}

export function skillMaterializationKeyForName(name: string): string {
  return materializedSkillDirectoryNameFor(name).toLowerCase();
}

export function selectedSkillDisplay(
  skill: Pick<SkillCatalogItem, 'id' | 'name'>,
): string {
  const reference = canonicalSkillReference(skill);
  const label = skillDisplayLabel(skill);
  return label === reference ? reference : `${label} (${reference})`;
}
