import { describe, expect, it } from 'vitest';

import { resolveModelSelection } from '@core/shared/model-catalog.js';
import {
  MODEL_FAMILIES,
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

  it('exposes isModelFamilyAlias for the runtime rewrite seam', () => {
    expect(isModelFamilyAlias('gpt-oss')).toBe(true);
    expect(isModelFamilyAlias('llama-70b')).toBe(true);
    expect(isModelFamilyAlias('opus')).toBe(false);
    expect(isModelFamilyAlias('')).toBe(false);
    expect(isModelFamilyAlias(undefined)).toBe(false);
  });
});
