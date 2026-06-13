import { logger } from '../infrastructure/logging/logger.js';
import {
  isModelFamilyAlias,
  resolveModelFamilyAlias,
} from '../shared/model-families.js';

// Host-side credential-driven model-family rewrite. When a selected model alias
// is a family alias (e.g. `gpt-oss`, `llama-70b`), rewrite it to a concrete
// member alias: the first member whose provider has a configured (active) Model
// Access credential for this app. If none are configured, the pure resolver
// falls back to the first member so resolution proceeds and the broker fails
// loudly with that provider's setup message. No runtime failover, no probing.
//
// The pure family resolver (`resolveModelFamilyAlias`) takes an injected
// `isProviderConfigured` predicate; this module sources the configured-provider
// set via the injected `listConfiguredProviders` lookup. Callers pass the
// runtime-store-backed lookup (`getConfiguredModelProvidersForApp`) so this
// runtime module never reaches into the adapter layer itself.

export type ConfiguredModelProvidersLookup = (
  appId: string,
) => Promise<Set<string>>;

// Resolve a possibly-family model alias to a concrete catalog alias using this
// app's configured providers. Non-family aliases pass through unchanged (the
// lookup is never called). On any lookup failure the original alias is returned
// (resolution then proceeds and fails loudly downstream) so a transient
// credential read never blocks a run.
export async function rewriteModelFamilyAliasForApp(input: {
  alias: string;
  appId: string;
  listConfiguredProviders: ConfiguredModelProvidersLookup;
}): Promise<string> {
  const { alias, appId, listConfiguredProviders } = input;
  if (!isModelFamilyAlias(alias)) return alias;
  let configured: Set<string>;
  try {
    configured = await listConfiguredProviders(appId);
  } catch (err) {
    logger.warn(
      { err, alias, appId },
      'Failed to read configured model providers for family resolution; using family alias unchanged',
    );
    return alias;
  }
  const resolved = resolveModelFamilyAlias(alias, {
    isProviderConfigured: (providerId) => configured.has(providerId),
  });
  return resolved ? resolved.alias : alias;
}
