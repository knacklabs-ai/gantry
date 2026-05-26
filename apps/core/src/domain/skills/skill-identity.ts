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

export interface SkillMaterializationCollision {
  key: string;
  skillIds: string[];
}

export function skillMaterializationCollisions(
  skills: Iterable<Pick<SkillCatalogItem, 'id' | 'name'>>,
): SkillMaterializationCollision[] {
  const byKey = new Map<string, Set<string>>();
  for (const skill of skills) {
    const key = skillMaterializationKey(skill);
    const skillIds = byKey.get(key) ?? new Set<string>();
    skillIds.add(canonicalSkillReference(skill));
    byKey.set(key, skillIds);
  }
  return [...byKey.entries()]
    .flatMap(([key, skillIds]) =>
      skillIds.size > 1
        ? [
            {
              key,
              skillIds: [...skillIds].sort(),
            },
          ]
        : [],
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function formatSkillMaterializationCollision(
  collision: SkillMaterializationCollision,
): string {
  const fragment = formatSkillMaterializationCollisionFragment(collision);
  return `${fragment.slice(0, 1).toUpperCase()}${fragment.slice(1)}.`;
}

export function formatSkillMaterializationCollisionFragment(
  collision: SkillMaterializationCollision,
): string {
  return `selected skills that materialize to the same runtime directory "${collision.key}": ${collision.skillIds.join(', ')}. Keep only one exact skill id`;
}
