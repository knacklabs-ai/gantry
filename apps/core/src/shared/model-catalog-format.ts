import {
  MODEL_CATALOG,
  type ModelCatalogEntry,
  type ModelDefaultAliases,
} from './model-catalog.js';
import { resolveModelCacheSupport } from './model-cache-support.js';
import {
  listModelFamilies,
  type FamilyOrderOverrides,
} from './model-families.js';
import {
  availabilityBadgeForProvider,
  describeFamilyAvailability,
  familyAvailabilityBadge,
} from './model-catalog-availability.js';

export interface ModelCatalogFormatOptions {
  defaults?: ModelDefaultAliases;
  // Provider/route ids with an ACTIVE Model Access credential for the current
  // app. When provided, each row gains an availability badge; when omitted the
  // list renders without badges (graceful degrade — same as before).
  configuredProviders?: Set<string>;
  // Optional settings-sourced family member-order override.
  familyOrder?: FamilyOrderOverrides;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${tokens / 1_000_000}M`;
  }
  if (tokens >= 1_000) {
    return `${tokens / 1_000}k`;
  }
  return String(tokens);
}

// Compact context-window label for catalog/CLI rows: "1.0M" / "131K" / "—" when
// the entry declares no window (SDK-lane entries also carry a window, so "—" is
// rare). Distinct from formatTokenCount (lowercase k, used for usage figures) to
// keep the column tidy.
export function formatContextWindow(tokens: number | undefined): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
    return '—';
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

export function formatModelDisplay(entry: ModelCatalogEntry): string {
  const experimental = entry.experimental ? ' experimental' : '';
  return `${entry.displayName} (${entry.modelRoute.label}${experimental})`;
}

export function formatModelCatalog(
  options: ModelCatalogFormatOptions = {},
): string {
  const { defaults = {}, configuredProviders, familyOrder } = options;
  const hasAvailability = configuredProviders !== undefined;
  const header = hasAvailability
    ? 'Alias | Model | Response family | Route | Context | Cache | Availability | Status'
    : 'Alias | Model | Response family | Route | Context | Cache | Status';
  const lines = [
    'Supported model aliases',
    header,
    header.replace(/[^|]+/g, '---'),
  ];
  for (const entry of MODEL_CATALOG) {
    const cacheSupport = resolveModelCacheSupport(entry);
    const contextWindow = formatContextWindow(entry.contextWindowTokens);
    const availability = availabilityBadgeForProvider(
      entry.modelRoute.id,
      configuredProviders,
    );
    for (const alias of entry.aliases) {
      const badges: string[] = [];
      if (alias === entry.recommendedAlias) badges.push('recommended');
      else badges.push('pinned');
      if (defaults.chat === alias) badges.push('chat default');
      if (defaults.oneTime === alias) badges.push('one-time default');
      if (defaults.recurring === alias) badges.push('recurring default');
      if (defaults.memoryExtractor === alias) badges.push('memory extractor');
      if (defaults.memoryDreaming === alias) badges.push('memory dreaming');
      if (defaults.memoryConsolidation === alias) {
        badges.push('memory consolidation');
      }
      const cells = [
        alias,
        entry.displayName,
        entry.responseFamily,
        entry.modelRoute.label,
        contextWindow,
        cacheSupport.statusLabel,
        ...(hasAvailability ? [availability ?? ''] : []),
        badges.join(', '),
      ];
      lines.push(cells.join(' | '));
    }
  }
  const families = listModelFamilies();
  if (families.length) {
    const familyHeader = hasAvailability
      ? 'Family | Model | Providers (preference order) | Availability'
      : 'Family | Model | Providers (preference order)';
    lines.push(
      '',
      'Model families (provider auto-selected by configured key)',
      familyHeader,
      familyHeader.replace(/[^|]+/g, '---'),
    );
    for (const family of families) {
      const description = describeFamilyAvailability(
        family,
        configuredProviders,
        familyOrder,
      );
      const order = description.members
        .map((entry) => entry.member)
        .join(' > ');
      const badge = familyAvailabilityBadge(description, configuredProviders);
      const cells = [
        family.alias,
        family.displayName,
        order,
        ...(hasAvailability ? [badge ?? ''] : []),
      ];
      lines.push(cells.join(' | '));
    }
  }
  return lines.join('\n');
}
