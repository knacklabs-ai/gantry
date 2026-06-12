# anthropic-memory-direct

Direct Anthropic Messages memory client for the **DeepAgents** memory engine.

## What this is

Host-side memory (extraction, dreaming, consolidation) is system-owned work with
no agent engine in scope; the engine is chosen by `memory.engine` in
`settings.yaml`. When `memory.engine: deepagents` and the resolved memory model
is Anthropic-family, the route-aware memory client dispatches here instead of the
Claude Agent SDK memory client (`anthropic-claude-agent/memory-query.ts`).

This client speaks the Anthropic Messages API (`POST /v1/messages`) over plain
`fetch` through the Gantry loopback model gateway. It imports **no** provider SDK
(`@anthropic-ai/*`) and no LangChain/DeepAgents package — only the
provider-neutral gateway injection helper shared with the OpenAI memory client.

## Provider boundary

This directory is an approved `ANTHROPIC_*` provider-boundary path
(`.codex/architecture-map.json` `approvedProviderBoundaryPaths` and
`.codex/scripts/architecture_rules.py`
`PROVIDER_BOUNDARY_DEFAULT_APPROVED_PATHS`) because it reads the
`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` gateway projection keys. Keep the count
of `ANTHROPIC_` tokens scoped to gateway projection reads; do not import the
Anthropic SDK here — the SDK lane is `anthropic-claude-agent/`.

## Auth

The gateway authenticates the inbound run-scoped `gtw_` token as a bearer and
injects the downstream `x-api-key` itself, so this client always sends
`Authorization: Bearer <gtw_token>` plus `anthropic-version`. Only `api_key`
credential mode reaches this lane; a Claude OAuth/subscription credential is
rejected with the locked copy when the broker auth mode is known.

## Usage accounting

Anthropic usage already reports `input_tokens`, `cache_read_input_tokens`, and
`cache_creation_input_tokens` as disjoint counts, so they map straight through to
`MemoryLlmUsage` with no subtraction — unlike the OpenAI client, where
`cached_tokens` is a subset of `prompt_tokens` and must be subtracted.
