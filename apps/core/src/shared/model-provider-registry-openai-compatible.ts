import { DEEPAGENTS_ENGINE } from './agent-engine.js';
import type {
  ModelProviderCacheSupport,
  ModelProviderDefinition,
} from './model-provider-registry.js';

// Eight OpenAI-chat-completions-compatible providers on the DeepAgents engine.
// Extracted from model-provider-registry.ts to keep that file under its line
// budget. They are composed back into MODEL_PROVIDER_DEFINITIONS so the registry
// stays the single source of provider truth and the derived `ModelProviderId`
// union covers them.
//
// PATH COMPOSITION (load-bearing — proven by gantry-model-gateway.test.ts):
//   The runner builds these via `initChatModel("openai:<id>", { configuration:
//   { baseURL } })`. The OpenAI SDK posts `<baseURL>/chat/completions`, where
//   `baseURL` is the raw loopback gateway base `http://127.0.0.1:<port>/<seg>`
//   (no `/v1`). The gateway therefore receives `/<seg>/chat/completions` and
//   builds the upstream URL as `upstreamOrigin + upstreamPathPrefix +
//   "/chat/completions"`. Each provider encodes its REAL upstream path before
//   `/chat/completions` in `upstreamPathPrefix`:
//     groq        -> https://api.groq.com/openai/v1/chat/completions
//     deepseek    -> https://api.deepseek.com/v1/chat/completions
//     xai         -> https://api.x.ai/v1/chat/completions
//     together    -> https://api.together.ai/v1/chat/completions
//     fireworks   -> https://api.fireworks.ai/inference/v1/chat/completions
//     cerebras    -> https://api.cerebras.ai/v1/chat/completions
//     perplexity  -> https://api.perplexity.ai/chat/completions (bare path)
//     gemini      -> https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
//   assertProviderPathAllowed strips the per-provider prefix, leaving
//   `/chat/completions`, which is allowlisted for the DeepAgents engine.
//
// CACHE: all but Perplexity cache automatically on the request prefix; the
// cached-read usage field differs by provider, so each declares its own
// usageFields.readTokens so host-side normalizeModelUsage accounts correctly.
// (The runner-side stream-normalizer reads the same variants directly.)

const API_KEY_BEARER_CREDENTIAL_MODES = [
  {
    id: 'api_key',
    label: 'API key',
    helpText: 'Use a provider API key for OpenAI-compatible chat completions.',
    version: 1,
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
      },
    ],
    gatewayAuth: {
      strategy: 'bearer',
      field: 'apiKey',
    },
  },
] as const;

const DEEPAGENTS_EXECUTION_ROUTE = {
  engine: DEEPAGENTS_ENGINE,
  executionProviderId: 'deepagents:langchain',
  supportedCredentialModes: ['api_key'],
} as const;

// Automatic prefix prompt caching, read-token field varies per provider. The
// `mode: 'openai_automatic_prefix'` keeps these on the catalog's
// `openai-automatic-prompt` cacheMode (resolveModelCacheProvider -> 'openai').
function automaticPrefixCache(
  readTokensField: string,
): ModelProviderCacheSupport {
  return {
    prompt: {
      mode: 'openai_automatic_prefix',
      automatic: true,
      requestControl: 'provider_automatic_prefix',
      ttlOptions: [],
      minimumTokenThresholds: [],
      usageFields: {
        readTokens: readTokensField,
      },
    },
    response: {
      mode: 'none',
      enabledByDefault: false,
      requestControl: 'none',
      requestHeaders: [],
      responseHeaders: [],
      usageBehavior: 'normal_usage',
    },
  };
}

const NO_CACHE_SUPPORT: ModelProviderCacheSupport = {
  prompt: {
    mode: 'none',
    automatic: false,
    requestControl: 'none',
    ttlOptions: [],
    minimumTokenThresholds: [],
    usageFields: {},
  },
  response: {
    mode: 'none',
    enabledByDefault: false,
    requestControl: 'none',
    requestHeaders: [],
    responseHeaders: [],
    usageBehavior: 'normal_usage',
  },
};

// The DeepAgents OpenAI-compatible providers all share the same shape: bearer
// api_key credential, OPENAI_BASE_URL/OPENAI_API_KEY sdk projection (so the
// loopback gateway base-url + gtw_ token reach the runner's ChatOpenAI), the
// chat-only DeepAgents execution route, and the experimental v1 workload set.
function openAiCompatibleProvider(input: {
  id: string;
  label: string;
  pathSegment: string;
  upstreamOrigin: string;
  upstreamPathPrefix: string;
  cacheSupport: ModelProviderCacheSupport;
}): ModelProviderDefinition {
  return {
    id: input.id,
    label: input.label,
    executable: true,
    modelRoute: true,
    embeddingProvider: false,
    responseFamily: 'openai',
    // Memory workloads are intentionally withheld in v1 (kept to gpt/kimi); the
    // memory dispatch routes by provider engine and would send these to the
    // OpenAI memory client, but no catalog entry declares memory workloads so
    // they are rejected before dispatch. Follow-up: extend memory coverage.
    supportedWorkloads: ['chat', 'one_time_job', 'recurring_job'],
    credentialModes: API_KEY_BEARER_CREDENTIAL_MODES,
    gateway: {
      pathSegment: input.pathSegment,
      upstreamOrigin: input.upstreamOrigin,
      upstreamPathPrefix: input.upstreamPathPrefix,
      sdkProjection: {
        baseUrlEnv: 'OPENAI_BASE_URL',
        tokenEnv: 'OPENAI_API_KEY',
        credentialProviderEnvKey: 'OPENAI_API_KEY',
        credentialProvider: input.id,
      },
    },
    cacheSupport: input.cacheSupport,
    executionRoute: DEEPAGENTS_EXECUTION_ROUTE,
  };
}

export const OPENAI_COMPATIBLE_PROVIDER_DEFINITIONS = [
  openAiCompatibleProvider({
    id: 'groq',
    label: 'Groq',
    pathSegment: 'groq',
    upstreamOrigin: 'https://api.groq.com',
    upstreamPathPrefix: '/openai/v1',
    cacheSupport: automaticPrefixCache('prompt_tokens_details.cached_tokens'),
  }),
  openAiCompatibleProvider({
    id: 'deepseek',
    label: 'DeepSeek',
    pathSegment: 'deepseek',
    upstreamOrigin: 'https://api.deepseek.com',
    upstreamPathPrefix: '/v1',
    // DeepSeek reports cache reads on a FLAT, non-nested field.
    cacheSupport: automaticPrefixCache('prompt_cache_hit_tokens'),
  }),
  openAiCompatibleProvider({
    id: 'xai',
    label: 'xAI (Grok)',
    pathSegment: 'xai',
    upstreamOrigin: 'https://api.x.ai',
    upstreamPathPrefix: '/v1',
    cacheSupport: automaticPrefixCache('prompt_tokens_details.cached_tokens'),
  }),
  openAiCompatibleProvider({
    id: 'together',
    label: 'Together AI',
    pathSegment: 'together',
    upstreamOrigin: 'https://api.together.ai',
    upstreamPathPrefix: '/v1',
    // Together reports cache reads on a FLAT usage.cached_tokens field.
    cacheSupport: automaticPrefixCache('cached_tokens'),
  }),
  openAiCompatibleProvider({
    id: 'fireworks',
    label: 'Fireworks AI',
    pathSegment: 'fireworks',
    upstreamOrigin: 'https://api.fireworks.ai',
    upstreamPathPrefix: '/inference/v1',
    cacheSupport: automaticPrefixCache('prompt_tokens_details.cached_tokens'),
  }),
  openAiCompatibleProvider({
    id: 'cerebras',
    label: 'Cerebras',
    pathSegment: 'cerebras',
    upstreamOrigin: 'https://api.cerebras.ai',
    upstreamPathPrefix: '/v1',
    cacheSupport: automaticPrefixCache('prompt_tokens_details.cached_tokens'),
  }),
  openAiCompatibleProvider({
    id: 'perplexity',
    label: 'Perplexity',
    pathSegment: 'perplexity',
    upstreamOrigin: 'https://api.perplexity.ai',
    // Perplexity serves chat/completions at the origin root (no /v1).
    upstreamPathPrefix: '',
    cacheSupport: NO_CACHE_SUPPORT,
  }),
  openAiCompatibleProvider({
    id: 'gemini',
    label: 'Google Gemini',
    pathSegment: 'gemini',
    upstreamOrigin: 'https://generativelanguage.googleapis.com',
    upstreamPathPrefix: '/v1beta/openai',
    // Implicit automatic caching; the cached-token field through the OpenAI
    // compat layer is UNVERIFIED. Best-effort: read the OpenAI-shaped field and
    // treat accounting as best-effort (do not block on it).
    cacheSupport: automaticPrefixCache('prompt_tokens_details.cached_tokens'),
  }),
] as const satisfies readonly ModelProviderDefinition[];
