import { describe, expect, it } from 'vitest';

import { resolveModelSelection } from '@core/shared/model-catalog.js';
import {
  MODEL_FAMILIES,
  describeFamilyResolution,
  effectiveFamilyMembers,
  getModelFamily,
  isModelFamilyAlias,
  listModelFamilies,
  providerIdForFamilyMember,
  resolveModelFamilyAlias,
  resolveModelSelectionForWorkloadWithFamilies,
} from '@core/shared/model-families.js';

const configured = (providers: string[]) => ({
  isProviderConfigured: (providerId: string) => providers.includes(providerId),
});

describe('model families', () => {
  it('seeds exactly the real catalog overlaps with preference order', () => {
    const gptOss = getModelFamily('gpt-oss');
    expect(gptOss?.members).toEqual(['groq-oss', 'cerebras']);
    const llama = getModelFamily('llama-70b');
    expect(llama?.members).toEqual(['groq', 'together']);
    expect(listModelFamilies()).toBe(MODEL_FAMILIES);
  });

  it('maps each member alias to its catalog provider id', () => {
    expect(providerIdForFamilyMember('groq-oss')).toBe('groq');
    expect(providerIdForFamilyMember('cerebras')).toBe('cerebras');
    expect(providerIdForFamilyMember('together')).toBe('together');
  });

  it('every family alias and member exists, and no alias collides with the catalog', () => {
    for (const family of MODEL_FAMILIES) {
      // A family alias must NOT be a concrete catalog alias.
      expect(resolveModelSelection(family.alias).ok).toBe(false);
      // Every member must be a real concrete catalog alias.
      for (const member of family.members) {
        expect(resolveModelSelection(member).ok).toBe(true);
      }
    }
  });

  describe('resolveModelFamilyAlias', () => {
    it('returns null for a non-family alias so the caller uses it unchanged', () => {
      // Concrete catalog aliases (including family members) are not families.
      expect(resolveModelFamilyAlias('opus', configured([]))).toBeNull();
      expect(resolveModelFamilyAlias('groq-oss', configured([]))).toBeNull();
      expect(resolveModelFamilyAlias('gpt-oss', configured([]))).not.toBeNull();
    });

    it('picks the first member whose provider is configured', () => {
      // Only the second member (cerebras) is configured -> resolve to cerebras.
      expect(
        resolveModelFamilyAlias('gpt-oss', configured(['cerebras'])),
      ).toEqual({ alias: 'cerebras' });
      // First member (groq) configured -> resolve to groq-oss (groq provider).
      expect(resolveModelFamilyAlias('gpt-oss', configured(['groq']))).toEqual({
        alias: 'groq-oss',
      });
      // Both configured -> first in preference order wins.
      expect(
        resolveModelFamilyAlias('gpt-oss', configured(['groq', 'cerebras'])),
      ).toEqual({ alias: 'groq-oss' });
    });

    it('falls back to the first member when no provider is configured', () => {
      expect(resolveModelFamilyAlias('gpt-oss', configured([]))).toEqual({
        alias: 'groq-oss',
      });
      expect(resolveModelFamilyAlias('llama-70b', configured([]))).toEqual({
        alias: 'groq',
      });
    });
  });

  describe('resolveModelSelectionForWorkloadWithFamilies', () => {
    it('accepts a family alias for chat and carries the family alias', () => {
      const resolved = resolveModelSelectionForWorkloadWithFamilies(
        'gpt-oss',
        'chat',
      );
      expect(resolved).toMatchObject({ ok: true, alias: 'gpt-oss' });
      // Borrows the first member's concrete entry for display.
      if (resolved.ok) {
        expect(resolved.entry.aliases).toContain('groq-oss');
      }
    });

    it('passes concrete aliases through unchanged', () => {
      expect(
        resolveModelSelectionForWorkloadWithFamilies('opus', 'chat'),
      ).toMatchObject({ ok: true, alias: 'opus' });
    });

    it('accepts family aliases for job workloads (all members support jobs)', () => {
      expect(
        resolveModelSelectionForWorkloadWithFamilies('gpt-oss', 'one_time_job'),
      ).toMatchObject({ ok: true, alias: 'gpt-oss' });
      expect(
        resolveModelSelectionForWorkloadWithFamilies(
          'llama-70b',
          'recurring_job',
        ),
      ).toMatchObject({ ok: true, alias: 'llama-70b' });
    });

    it('rejects a family alias for a workload no member supports', () => {
      // The deepagents-lane members are scoped to chat + jobs, not memory.
      expect(
        resolveModelSelectionForWorkloadWithFamilies(
          'gpt-oss',
          'memory_extractor',
        ),
      ).toMatchObject({ ok: false, reason: 'unsupported-workload' });
    });
  });

  describe('effectiveFamilyMembers (settings order override)', () => {
    const gptOss = getModelFamily('gpt-oss')!;

    it('returns the hardcoded order with no override', () => {
      expect(effectiveFamilyMembers(gptOss)).toEqual(['groq-oss', 'cerebras']);
      expect(effectiveFamilyMembers(gptOss, {})).toEqual([
        'groq-oss',
        'cerebras',
      ]);
    });

    it('reorders members by override, accepting member alias or provider id', () => {
      // By member alias.
      expect(
        effectiveFamilyMembers(gptOss, { 'gpt-oss': ['cerebras', 'groq-oss'] }),
      ).toEqual(['cerebras', 'groq-oss']);
      // By provider id (cerebras provider == cerebras member; groq provider ==
      // groq-oss member).
      expect(
        effectiveFamilyMembers(gptOss, { 'gpt-oss': ['cerebras', 'groq'] }),
      ).toEqual(['cerebras', 'groq-oss']);
    });

    it('ignores unknown tokens and appends unnamed default members', () => {
      expect(
        effectiveFamilyMembers(gptOss, {
          'gpt-oss': ['nope', 'cerebras', 'also-unknown'],
        }),
      ).toEqual(['cerebras', 'groq-oss']);
    });

    it('honors the override in resolveModelFamilyAlias', () => {
      // Override puts cerebras first; both providers configured -> cerebras wins.
      expect(
        resolveModelFamilyAlias('gpt-oss', {
          ...configured(['groq', 'cerebras']),
          order: { 'gpt-oss': ['cerebras', 'groq-oss'] },
        }),
      ).toEqual({ alias: 'cerebras' });
    });

    it('honors the override in resolveModelSelectionForWorkloadWithFamilies display', () => {
      const resolved = resolveModelSelectionForWorkloadWithFamilies(
        'gpt-oss',
        'chat',
        { 'gpt-oss': ['cerebras', 'groq-oss'] },
      );
      expect(resolved).toMatchObject({ ok: true, alias: 'gpt-oss' });
      // Borrows the FIRST effective member (cerebras) for display.
      if (resolved.ok) expect(resolved.entry.aliases).toContain('cerebras');
    });
  });

  describe('describeFamilyResolution', () => {
    const gptOss = getModelFamily('gpt-oss')!;
    const labelFor = (id: string | undefined) => id ?? 'unknown';

    it('selects the first configured member and reports availability', () => {
      const description = describeFamilyResolution(gptOss, {
        isProviderConfigured: (id) => id === 'cerebras',
        providerLabel: labelFor,
      });
      expect(description.selectedMember).toBe('cerebras');
      expect(description.selectedProviderId).toBe('cerebras');
      expect(description.selectedConfigured).toBe(true);
      expect(description.members.map((m) => m.configured)).toEqual([
        false,
        true,
      ]);
    });

    it('falls back to the first effective member when none configured', () => {
      const description = describeFamilyResolution(gptOss, {
        isProviderConfigured: () => false,
        providerLabel: labelFor,
      });
      expect(description.selectedMember).toBe('groq-oss');
      expect(description.selectedConfigured).toBe(false);
    });
  });

  it('exposes isModelFamilyAlias for the runtime rewrite seam', () => {
    expect(isModelFamilyAlias('gpt-oss')).toBe(true);
    expect(isModelFamilyAlias('llama-70b')).toBe(true);
    expect(isModelFamilyAlias('opus')).toBe(false);
    expect(isModelFamilyAlias('')).toBe(false);
    expect(isModelFamilyAlias(undefined)).toBe(false);
  });
});
