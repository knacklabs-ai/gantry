import type {
  ModelCatalogEntry,
  ModelRouteId,
  ModelWorkload,
} from './model-catalog.js';

// Catalog entries for the eight OpenAI-chat-completions-compatible DeepAgents
// providers. Extracted from model-catalog.ts to keep that file under its line
// budget. This module is a pure builder: model-catalog.ts passes in its own
// `executableModelEntry` + `providerRoute` helpers, so there is NO runtime
// import back into model-catalog.ts (which would create an import cycle —
// model-catalog.ts already imports this builder).
//
// These run on the deepagents (LangChain) lane, so context-window/max-output
// limits and the thinking/tool capability flags are reported at runtime from the
// LangChain model profile and are intentionally NOT hardcoded here. Pricing is
// likewise omitted (LangChain/model-profile data carries no cost information).
// cacheMode/cacheTokenFields stay declared because prompt caching and its usage
// accounting are a provider response-shape contract, not model-profile data.
//
// cacheMode 'openai-automatic-prompt' resolves (via model-cache-support.ts) to
// the 'openai' normalized cache provider, matching each provider's
// cacheSupport.prompt.mode === 'openai_automatic_prefix'. Perplexity has no
// prompt cache (cacheMode 'none'). cacheTokenFields mirror the provider
// registry's usageFields.readTokens so host + runner accounting agree.

type ProviderRouteFn = (
  providerId: string,
  providerModelId: string,
) => { id: ModelRouteId; label: string; providerModelId: string };

type ExecutableModelEntryFn = (input: {
  id: string;
  route: { id: ModelRouteId; label: string; providerModelId: string };
  displayName: string;
  runnerModel: string;
  aliases: readonly string[];
  recommendedAlias: string;
  source: ModelCatalogEntry['source'];
  cacheMode: ModelCatalogEntry['cacheMode'];
  cacheTokenFields: readonly string[];
  supportedWorkloads: readonly ModelWorkload[];
  experimental?: boolean;
}) => ModelCatalogEntry;

const OPENAI_PREFIX_CACHE_MODE = 'openai-automatic-prompt' as const;
// v1 workloads: chat + jobs only (no memory — kept to gpt/kimi as a follow-up).
const DEEPAGENTS_WORKLOADS: readonly ModelWorkload[] = [
  'chat',
  'one_time_job',
  'recurring_job',
];

const GROQ_SOURCE = {
  label: 'Groq OpenAI-compatible chat completions',
  url: 'https://console.groq.com/docs/openai',
  verifiedAt: '2026-06-13',
};
const DEEPSEEK_SOURCE = {
  label: 'DeepSeek API (OpenAI-compatible)',
  url: 'https://api-docs.deepseek.com/',
  verifiedAt: '2026-06-13',
};
const XAI_SOURCE = {
  label: 'xAI Grok API (OpenAI-compatible)',
  url: 'https://docs.x.ai/docs/api-reference',
  verifiedAt: '2026-06-13',
};
const TOGETHER_SOURCE = {
  label: 'Together AI chat completions',
  url: 'https://docs.together.ai/docs/chat-overview',
  verifiedAt: '2026-06-13',
};
const FIREWORKS_SOURCE = {
  label: 'Fireworks AI querying chat completions',
  url: 'https://docs.fireworks.ai/api-reference/post-chatcompletions',
  verifiedAt: '2026-06-13',
};
const CEREBRAS_SOURCE = {
  label: 'Cerebras Inference (OpenAI-compatible)',
  url: 'https://inference-docs.cerebras.ai/api-reference/chat-completions',
  verifiedAt: '2026-06-13',
};
const PERPLEXITY_SOURCE = {
  label: 'Perplexity Sonar API',
  url: 'https://docs.perplexity.ai/api-reference/chat-completions-post',
  verifiedAt: '2026-06-13',
};
const GEMINI_SOURCE = {
  label: 'Gemini OpenAI compatibility',
  url: 'https://ai.google.dev/gemini-api/docs/openai',
  verifiedAt: '2026-06-13',
};

const NESTED_OPENAI_CACHE_FIELDS = ['prompt_tokens_details.cached_tokens'];

export function buildOpenAiCompatibleCatalog(deps: {
  executableModelEntry: ExecutableModelEntryFn;
  providerRoute: ProviderRouteFn;
}): readonly ModelCatalogEntry[] {
  const { executableModelEntry, providerRoute } = deps;
  return [
    // groq
    executableModelEntry({
      id: 'groq:llama-3.3-70b-versatile',
      route: providerRoute('groq', 'llama-3.3-70b-versatile'),
      displayName: 'Groq Llama 3.3 70B Versatile',
      runnerModel: 'llama-3.3-70b-versatile',
      aliases: ['groq', 'groq-llama-3.3-70b'],
      recommendedAlias: 'groq',
      source: GROQ_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'groq:llama-3.1-8b-instant',
      route: providerRoute('groq', 'llama-3.1-8b-instant'),
      displayName: 'Groq Llama 3.1 8B Instant',
      runnerModel: 'llama-3.1-8b-instant',
      aliases: ['groq-fast', 'groq-llama-3.1-8b'],
      recommendedAlias: 'groq-fast',
      source: GROQ_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'groq:gpt-oss-120b',
      route: providerRoute('groq', 'openai/gpt-oss-120b'),
      displayName: 'Groq GPT-OSS 120B',
      runnerModel: 'openai/gpt-oss-120b',
      aliases: ['groq-oss', 'groq-gpt-oss-120b'],
      recommendedAlias: 'groq-oss',
      source: GROQ_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // deepseek
    executableModelEntry({
      id: 'deepseek:deepseek-v4-pro',
      route: providerRoute('deepseek', 'deepseek-v4-pro'),
      displayName: 'DeepSeek V4 Pro',
      runnerModel: 'deepseek-v4-pro',
      aliases: ['deepseek', 'deepseek-v4-pro'],
      recommendedAlias: 'deepseek',
      source: DEEPSEEK_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: ['prompt_cache_hit_tokens'],
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'deepseek:deepseek-v4-flash',
      route: providerRoute('deepseek', 'deepseek-v4-flash'),
      displayName: 'DeepSeek V4 Flash',
      runnerModel: 'deepseek-v4-flash',
      aliases: ['deepseek-fast', 'deepseek-v4-flash'],
      recommendedAlias: 'deepseek-fast',
      source: DEEPSEEK_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: ['prompt_cache_hit_tokens'],
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // xai (Grok)
    executableModelEntry({
      id: 'xai:grok-4.3',
      route: providerRoute('xai', 'grok-4.3'),
      displayName: 'Grok 4.3',
      runnerModel: 'grok-4.3',
      aliases: ['grok', 'grok-4.3'],
      recommendedAlias: 'grok',
      source: XAI_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'xai:grok-build-0.1',
      route: providerRoute('xai', 'grok-build-0.1'),
      displayName: 'Grok Build 0.1',
      runnerModel: 'grok-build-0.1',
      aliases: ['grok-fast', 'grok-build-0.1'],
      recommendedAlias: 'grok-fast',
      source: XAI_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // together
    executableModelEntry({
      id: 'together:llama-3.3-70b-instruct-turbo',
      route: providerRoute(
        'together',
        'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      ),
      displayName: 'Together Llama 3.3 70B Instruct Turbo',
      runnerModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      aliases: ['together', 'together-llama-3.3-70b'],
      recommendedAlias: 'together',
      source: TOGETHER_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: ['cached_tokens'],
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'together:qwen3-235b-a22b-fp8-tput',
      route: providerRoute('together', 'Qwen/Qwen3-235B-A22B-fp8-tput'),
      displayName: 'Together Qwen3 235B A22B',
      runnerModel: 'Qwen/Qwen3-235B-A22B-fp8-tput',
      aliases: ['together-qwen', 'together-qwen3-235b'],
      recommendedAlias: 'together-qwen',
      source: TOGETHER_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: ['cached_tokens'],
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // fireworks
    executableModelEntry({
      id: 'fireworks:deepseek-v3p1',
      route: providerRoute(
        'fireworks',
        'accounts/fireworks/models/deepseek-v3p1',
      ),
      displayName: 'Fireworks DeepSeek v3p1',
      runnerModel: 'accounts/fireworks/models/deepseek-v3p1',
      aliases: ['fireworks', 'fireworks-deepseek-v3p1'],
      recommendedAlias: 'fireworks',
      source: FIREWORKS_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'fireworks:llama-v3p1-8b-instruct',
      route: providerRoute(
        'fireworks',
        'accounts/fireworks/models/llama-v3p1-8b-instruct',
      ),
      displayName: 'Fireworks Llama v3p1 8B Instruct',
      runnerModel: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
      aliases: ['fireworks-fast', 'fireworks-llama-v3p1-8b'],
      recommendedAlias: 'fireworks-fast',
      source: FIREWORKS_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // cerebras
    executableModelEntry({
      id: 'cerebras:gpt-oss-120b',
      route: providerRoute('cerebras', 'gpt-oss-120b'),
      displayName: 'Cerebras GPT-OSS 120B',
      runnerModel: 'gpt-oss-120b',
      aliases: ['cerebras', 'cerebras-gpt-oss-120b'],
      recommendedAlias: 'cerebras',
      source: CEREBRAS_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'cerebras:zai-glm-4.7',
      route: providerRoute('cerebras', 'zai-glm-4.7'),
      displayName: 'Cerebras ZAI GLM 4.7',
      runnerModel: 'zai-glm-4.7',
      aliases: ['cerebras-glm', 'cerebras-zai-glm-4.7'],
      recommendedAlias: 'cerebras-glm',
      source: CEREBRAS_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // perplexity — no prompt cache
    executableModelEntry({
      id: 'perplexity:sonar-pro',
      route: providerRoute('perplexity', 'sonar-pro'),
      displayName: 'Perplexity Sonar Pro',
      runnerModel: 'sonar-pro',
      aliases: ['perplexity', 'perplexity-sonar-pro'],
      recommendedAlias: 'perplexity',
      source: PERPLEXITY_SOURCE,
      cacheMode: 'none',
      cacheTokenFields: [],
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'perplexity:sonar',
      route: providerRoute('perplexity', 'sonar'),
      displayName: 'Perplexity Sonar',
      runnerModel: 'sonar',
      aliases: ['perplexity-sonar'],
      recommendedAlias: 'perplexity-sonar',
      source: PERPLEXITY_SOURCE,
      cacheMode: 'none',
      cacheTokenFields: [],
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    // gemini (via OpenAI-compat endpoint)
    executableModelEntry({
      id: 'gemini:gemini-2.5-pro',
      route: providerRoute('gemini', 'gemini-2.5-pro'),
      displayName: 'Gemini 2.5 Pro',
      runnerModel: 'gemini-2.5-pro',
      aliases: ['gemini', 'gemini-2.5-pro'],
      recommendedAlias: 'gemini',
      source: GEMINI_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      // Best-effort: Gemini's cached-token field via the OpenAI-compat layer is
      // UNVERIFIED; accounting is best-effort and must not block.
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'gemini:gemini-2.5-flash',
      route: providerRoute('gemini', 'gemini-2.5-flash'),
      displayName: 'Gemini 2.5 Flash',
      runnerModel: 'gemini-2.5-flash',
      aliases: ['gemini-flash', 'gemini-2.5-flash'],
      recommendedAlias: 'gemini-flash',
      source: GEMINI_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
    executableModelEntry({
      id: 'gemini:gemini-3.5-flash',
      route: providerRoute('gemini', 'gemini-3.5-flash'),
      displayName: 'Gemini 3.5 Flash',
      runnerModel: 'gemini-3.5-flash',
      aliases: ['gemini-3-flash', 'gemini-3.5-flash'],
      recommendedAlias: 'gemini-3-flash',
      source: GEMINI_SOURCE,
      cacheMode: OPENAI_PREFIX_CACHE_MODE,
      cacheTokenFields: NESTED_OPENAI_CACHE_FIELDS,
      supportedWorkloads: DEEPAGENTS_WORKLOADS,
      experimental: true,
    }),
  ];
}
