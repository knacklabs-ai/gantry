import {
  resolveModelSelection,
  resolveModelSelectionForWorkload,
  type ModelResolution,
  type ModelRouteId,
  type ModelWorkload,
} from './model-catalog.js';

// Model families let a user select a base MODEL and have Gantry auto-pick the
// PROVIDER based on which provider's API key is configured (Model Access), in a
// declared preference order. A family alias is NOT a catalog alias: it is a
// separate selector whose `members` are EXISTING concrete catalog aliases in
// preference order. At resolution time the first member whose provider has a
// configured credential wins; if none are configured we fall back to the first
// member so resolution proceeds and the broker fails loudly with that
// provider's setup message (no runtime failover, no health probing in v1).
//
// This module is pure: it depends only on the catalog (no repo/IO). The
// `isProviderConfigured` predicate is injected by the caller.

export interface ModelFamily {
  alias: string;
  displayName: string;
  // Concrete catalog aliases in preference order. The first member whose
  // provider has a configured credential is selected.
  members: readonly string[];
}

// Seed exactly the real overlaps in the current catalog. Keep this trivial to
// extend as more overlapping providers are added.
export const MODEL_FAMILIES: readonly ModelFamily[] = [
  {
    alias: 'gpt-oss',
    displayName: 'GPT-OSS 120B',
    members: ['groq-oss', 'cerebras'],
  },
  {
    alias: 'llama-70b',
    displayName: 'Llama 3.3 70B',
    members: ['groq', 'together'],
  },
] as const;

function normalizeFamilyKey(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

// Built at load: this also runs the collision/membership guards below (mirrors
// the catalog's buildAliasIndex), throwing if any family alias collides with a
// concrete catalog alias or references an unknown member.
const FAMILY_INDEX = buildFamilyIndex();

function buildFamilyIndex(): Map<string, ModelFamily> {
  const families = new Map<string, ModelFamily>();
  for (const family of MODEL_FAMILIES) {
    const key = normalizeFamilyKey(family.alias);
    if (families.has(key)) {
      throw new Error(`Duplicate model family alias: ${family.alias}`);
    }
    // A family alias MUST NOT collide with any concrete catalog alias: the two
    // namespaces are separate and resolution depends on that separation.
    const catalogCollision = resolveModelSelection(family.alias);
    if (catalogCollision.ok) {
      throw new Error(
        `Model family alias ${family.alias} collides with catalog alias ${catalogCollision.alias}.`,
      );
    }
    // Every member must be a real concrete catalog alias.
    for (const member of family.members) {
      const resolved = resolveModelSelection(member);
      if (!resolved.ok) {
        throw new Error(
          `Model family ${family.alias} references unknown member alias ${member}.`,
        );
      }
    }
    families.set(key, family);
  }
  return families;
}

export function listModelFamilies(): readonly ModelFamily[] {
  return MODEL_FAMILIES;
}

export function isModelFamilyAlias(value: string | null | undefined): boolean {
  if (!value) return false;
  return FAMILY_INDEX.has(normalizeFamilyKey(value));
}

export function getModelFamily(
  value: string | null | undefined,
): ModelFamily | undefined {
  if (!value) return undefined;
  return FAMILY_INDEX.get(normalizeFamilyKey(value));
}

// Map a member alias to its provider id via the catalog
// (resolveModelSelection(member).entry.modelRoute.id).
export function providerIdForFamilyMember(
  member: string,
): ModelRouteId | undefined {
  const resolved = resolveModelSelection(member);
  return resolved.ok ? resolved.entry.modelRoute.id : undefined;
}

export interface ModelFamilyResolution {
  alias: string;
}

// Resolve a family alias to a concrete member alias.
//   - If `alias` is NOT a family alias -> null (caller uses the alias unchanged).
//   - Otherwise -> the first member whose provider satisfies
//     `isProviderConfigured`. If none configured -> the FIRST member, so
//     resolution proceeds and the broker fails loudly with that provider's
//     setup message.
// Pure/sync: the `isProviderConfigured` predicate is injected.
export function resolveModelFamilyAlias(
  alias: string | null | undefined,
  deps: { isProviderConfigured: (providerId: string) => boolean },
): ModelFamilyResolution | null {
  const family = getModelFamily(alias);
  if (!family) return null;
  for (const member of family.members) {
    const providerId = providerIdForFamilyMember(member);
    if (providerId && deps.isProviderConfigured(providerId)) {
      return { alias: member };
    }
  }
  return { alias: family.members[0] };
}

// Family-aware workload resolution for the user-selection seam (/model set).
// A concrete alias resolves through the catalog unchanged. A family alias is
// accepted iff EVERY member supports the workload (all members are chat models
// today); the returned resolution carries the FAMILY alias (so /model gpt-oss
// stores gpt-oss) but borrows the first member's concrete entry/runnerModel for
// display. The credential-driven provider is picked later at spawn.
export function resolveModelSelectionForWorkloadWithFamilies(
  value: string | null | undefined,
  workload: ModelWorkload,
): ModelResolution {
  const family = getModelFamily(value);
  if (!family) {
    return resolveModelSelectionForWorkload(value, workload);
  }
  const unsupported = family.members.find((member) => {
    const resolved = resolveModelSelectionForWorkload(member, workload);
    return !resolved.ok;
  });
  if (unsupported) {
    return {
      ok: false,
      input: family.alias,
      reason: 'unsupported-workload',
      message: `Model family "${family.alias}" is not eligible for this workload. Use /models to view supported workloads.`,
    };
  }
  const firstMember = resolveModelSelectionForWorkload(
    family.members[0],
    workload,
  );
  if (!firstMember.ok) return firstMember;
  return {
    ok: true,
    alias: family.alias,
    entry: firstMember.entry,
    runnerModel: firstMember.runnerModel,
  };
}
