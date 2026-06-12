# DeepAgents (LangChain) Execution Adapter

`deepagents:langchain` execution adapter + adapter-owned runner. Selected for
agents whose engine is DeepAgents (`agent_engine: deepagents`) on OpenAI-endpoint
and Anthropic-API-key model routes. This is an **approved provider-boundary
path** (`.codex/architecture-map.json` + `architecture_rules.py`): DeepAgents /
LangChain imports and `ANTHROPIC_`/`OPENAI_` env keys live only here.

## Layout

- `execution-adapter.ts` — `AgentExecutionAdapter`. Resolves the dist runner
  (`<runnerDistDir>/../adapters/llm/deepagents-langchain/runner/index.js`),
  validates the credential projection, projects gateway model env, points the
  runner at an adapter-owned sessions dir.
- `credential-validation.ts` — credential-mode guard. Selected only for this
  engine, so it enforces `supportedCredentialModes: ['api_key']` here: Claude
  OAuth is rejected with the locked copy; missing Model Access uses the
  setup-required copy.
- `model-credential-env.ts` — allowlist (`OPENAI_*`, `ANTHROPIC_*`,
  `NODE_EXTRA_CA_CERTS`) projected to `runnerInputPatch.modelCredentialEnv` only.
- `runner/` — the child process. `model-factory.ts` builds `ChatOpenAI`
  (`configuration.baseURL`) / `ChatAnthropic` (`anthropicApiUrl`, env is NOT read
  by ChatAnthropic) explicitly from gateway env. `stream-normalizer.ts` is a pure
  function over `streamEvents(..., {version:'v2'})` → neutral runner frames
  (unit-tested without network). `session-store.ts` is the adapter-private live
  session projection. `deep-agent-runner.ts` wires `createDeepAgent`.
- `runner/mcp-tools.ts` — connects Gantry-owned MCP authority via
  `@langchain/mcp-adapters` `MultiServerMCPClient`: it spawns the Gantry facade
  stdio server (`GANTRY_MCP_SERVER_PATH`) with the projected env block, filters
  the facade tools to the host-selected name set, and connects selected
  third-party MCP servers (`GANTRY_MCP_CONFIG_FILE`). DeepAgents has no
  autonomous MCP; this is the only place tools enter the graph.
- `runner/gantry-mcp-env.ts` — builds the Gantry facade server env block from the
  runner's process env + `agentInput.allowedTools`, reusing the shared
  `gantry-mcp-tool-surface` selection helpers. Strips `browser_*` tools unless the
  host provided `GANTRY_BROWSER_IPC_AUTH_TOKEN` AND the agent selected `Browser`.
- `runner/third-party-mcp-gate.ts` — wraps each selected third-party MCP tool with
  the neutral runner tool gate (`runner/tool-gate-core.ts`) + the neutral
  permission-IPC client (`runner/permission-ipc-client.ts`) before execution.
- `runner/builtin-tool-exclusion.ts` — a `langchain` `createMiddleware`
  `wrapModelCall` that strips `task` and `write_todos` from the model-visible
  tool list (see task/write_todos decision below).
- `runner/runtime-env.ts` — reads the common `GANTRY_*` host env and builds the
  `PermissionIpcRuntimeEnv` for the neutral permission-IPC client.

## Authority bridge (packet D)

Projected tool inventory for a run, all reachable only through Gantry policy:

- **Gantry facade tools** (`send_message`, `ask_user_question`, `memory_*`,
  `file`, `request_*`, `scheduler_*`, `mcp_list_tools`, `mcp_call_tool`, …): from
  the Gantry facade stdio MCP server, filtered to `selectedGantryMcpToolNames`.
- **Canonical Browser gateway tools** (`browser_status/open/inspect/act/close`):
  same server, mounted only when browser IPC is enabled.
- **Selected third-party MCP tools** (`mcp__<server>__<tool>`): from
  `GANTRY_MCP_CONFIG_FILE` servers, each wrapped with the permission gate.

Third-party MCP permission flow (end to end): the wrapped tool's `func` runs the
neutral pre-checks (protected-capability + memory-boundary hard denials), then
`ToolExecutionPolicyService.evaluate` against the agent's selected rules. Allowed
→ the underlying tool runs. Otherwise → `requestPermissionApprovalViaIpc` writes
a signed `permission-requests/<id>.json` file; the HOST (`runtime/ipc.ts`) turns
it into a durable `pending_interactions` row BEFORE any prompt renders, then
returns a signed decision. Approved → the underlying tool runs; denied → the gate
returns a deny string to the model (imitating the anthropic-lane deny copy)
without invoking the tool. Locked-preset agents are hard-denied without prompting.

Raw DeepAgents authority stays disabled: default `StateBackend` (no `execute`),
deny-all filesystem `permissions`, never `LocalShellBackend`/`FilesystemBackend`.

`task` / `write_todos` decision: DeepAgents 1.10.2 bakes both middlewares into
`createDeepAgent` unconditionally — there is no config switch to omit them.
`createDeepAgent` itself uses a `wrapModelCall` middleware to exclude tools (its
private `_ToolExclusionMiddleware`); we use the identical supported pattern via
the public `middleware` param to strip `task` and `write_todos` from the
model-visible tool list, so the model can never call them. v1-SAFEST: `task`
sub-runs are not policy-reviewed, so the spawner must not be reachable.

rg guard: this directory reads NO raw DeepAgents/MCP `.mcp.json` authority file —
`rg -n "\.mcp\.json" apps/core/src/adapters/llm/deepagents-langchain` must be
empty. Enforced by `deepagents-raw-authority-denial.test.ts`.

Memory context placement: the durable-memory block (host-tagged
`<gantry_memory_context trust="untrusted_data_only">`) is injected exactly once
as a leading user (`HumanMessage`) — model-visible prompt context, never system
authority. The system prompt carries the separate
`composeSystemPromptAppend` boundary-policy framing (not the tag). This matches
the anthropic lane and is asserted by `deepagents-memory-context.test.ts`.

Neutral extraction note: the runner-side tool gate decision core
(`runner/tool-gate-core.ts`) and the file-IPC permission-approval client
(`runner/permission-ipc-client.ts`) are provider-neutral and live under
`apps/core/src/runner/`. The anthropic lane keeps its own
`permission-callback.ts` (it owns run-scoped timed-grant batching the DeepAgents
v1 lane does not need) and delegates its protected-capability guard to
`tool-gate-core.ts`.

## Locked v1 constraints

- Model credentials reach the runner ONLY via the loopback gateway env
  (`runnerInputPatch.modelCredentialEnv`); never via `toolNetworkEnv`. Tokens are
  run-scoped `gtw_` gateway tokens, never raw provider secrets.
- Context-window figures are reported at runtime from `model.profile`
  (`maxInputTokens`); never hardcode them (catalog deepagents entries omit them).
- Frames must match the host parser (`runner/runner-frame.ts`, mirrors
  `AgentOutput` in `agent-spawn-types.ts`): live turns emit `newSessionId` first,
  stream text deltas, then a final usage/contextUsage frame. Scheduled jobs are
  ephemeral (no session persistence).
- Live-turn control parity (`runner/live-control.ts`): a poll loop watches the
  neutral IPC-input dir while a turn is in flight. A `_close` sentinel (host
  `/stop` or close-stdin, both written by `continuation-input.ts`) aborts the
  in-flight LangGraph stream via an `AbortSignal` threaded into `streamEvents`,
  and the runner emits a terminal success frame (graceful stop, mirroring the
  Anthropic lane). Mid-stream follow-ups are buffered and drive an additional
  turn, with the prior terminal frame carrying `continuedByFollowup`. The host
  delivery is engine-neutral, so no host code branches on engine.
- Scheduled-job heartbeat parity (`runner/job-heartbeat.ts`): scheduled runs
  emit a `JOB_HEARTBEAT` runtime-event frame every 15s (same shape as the
  Anthropic `job-heartbeat.ts`) so the host idle-stall detection
  (`agent-spawn-scheduled-idle.ts`) and lease activity tracking behave
  identically. Each streamed frame marks activity. Interactive runs emit none.
