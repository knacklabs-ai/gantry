# Gantry Web UI Implementation Plan

## Branch And Change Boundary

The first implementation action is to branch from the latest `main`:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feature/gantry-web-ui-initiate
```

This document is the only deliverable in the planning change. It defines the
future UI implementation but does not add frontend code, dependencies, API
routes, settings, schemas, or generated artifacts.

## Goal

Build a local-first Gantry operator UI that can configure agents, inspect
runtime state, chat with agents, resolve interactions, and administer providers,
conversations, jobs, people, and workflows through Gantry-owned application
services.

The UI must:

- use current Control API and contract surfaces wherever they already exist;
- use REST for snapshots and commands and durable HTTP SSE for live updates;
- keep Slack and other provider WebSockets inside channel adapters;
- render the existing `InteractionDescriptor` and `render_*` protocol;
- preserve settings, credential, permission, and audit authority boundaries;
- work at desktop and mobile widths in light and dark themes.

## Non-Goals

- No server-side rendering.
- No browser-to-Gantry WebSocket protocol.
- No provider-native Slack, Teams, Telegram, or Discord payloads in React
  components.
- No browser access to Control API keys, provider credentials, model
  credentials, runtime secrets, or agent credentials.
- No user-facing subagent mission-control view; delegation remains an internal
  execution detail.
- No enterprise SSO in the first local-only slice. Non-loopback UI exposure
  remains disabled until a separate identity design is approved.
- No parallel UI backend, duplicate application services, or second event
  store.

## Current UI-Relevant Baseline

- Gantry has no browser frontend package or static UI host.
- The Control API exposes HTTP routes and session SSE; `packages/contracts`
  owns shared public shapes and `packages/sdk` remains a server-side Node
  client.
- Postgres `runtime_events` is the durable observable stream for sessions,
  conversations, runs, jobs, permissions, interactions, and usage.
- Agents expose the UI-facing concepts needed for administration: identity,
  model and harness defaults, profile files, sources, capabilities,
  permissions, conversation installs, sessions, memory, jobs, and usage.
- `settings_revisions` is durable desired-state authority. Every settings-owned
  mutation must pass through `SettingsDesiredStateService`, append a revision,
  update runtime projection, and synchronize `settings.yaml`.
- `InteractionDescriptor` is the canonical channel-neutral shape for status,
  facts, lists, tables, forms, media, progress, approvals, questions, files,
  dependencies, and results.

Only these runtime details affect the UI design. Runner internals, scheduler
lease algorithms, and provider model execution are intentionally outside this
plan.

## Communication Architecture

```mermaid
flowchart LR
  UI["Gantry Web UI"] -->|"REST snapshots and commands"| API["Control API"]
  API --> APP["Application services"]
  APP --> PG[("Postgres")]
  PG --> EVENTS["Durable runtime events"]
  EVENTS -->|"HTTP SSE with cursor replay"| UI

  PROVIDER["Slack or another provider"] <-->|"Provider WebSocket or webhook"| ADAPTER["Channel adapter"]
  ADAPTER -->|"Canonical message or interaction"| APP
  APP --> AGENT["Agent runtime"]
  AGENT -->|"Channel-neutral output"| ADAPTER
  ADAPTER -->|"Provider HTTPS delivery"| PROVIDER
```

### Browser To Gantry

| Direction         | Transport            | Responsibility                                                                                                |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Browser to server | REST                 | Authentication, reads, chat submission, settings changes, approvals, job actions, and all other mutations     |
| Server to browser | SSE                  | Durable progress, streaming output, message changes, interaction state, job/run state, usage, and diagnostics |
| Recovery          | REST plus SSE cursor | Re-fetch authoritative snapshots and replay events after the last applied `eventId`                           |

The browser starts each page from a REST snapshot. TanStack Query owns the
snapshot cache. One SSE coordinator receives typed events, patches simple
records, and invalidates complex query aggregates for REST refetching.

SSE is observable output only. It must never approve a request, stop a run,
change settings, or otherwise act as command authority.

### Chat Turn Sequence

```mermaid
sequenceDiagram
  participant UI as Web UI
  participant API as Control API
  participant PG as Postgres
  participant RUN as Agent runtime

  UI->>API: POST /v1/sessions/:sessionId/messages
  API->>PG: Persist message and accepted runtime event
  API-->>UI: 202 accepted with messageId and acceptedEventId
  API->>RUN: Admit durable live turn
  RUN->>PG: Persist progress, interaction, usage, and output events
  PG-->>UI: SSE events after last eventId
  UI->>API: GET authoritative snapshot when invalidated
```

The current session APIs remain the chat foundation:

- `POST /v1/sessions/ensure`
- `GET /v1/sessions/{sessionId}`
- `GET|POST /v1/sessions/{sessionId}/messages`
- `GET /v1/sessions/{sessionId}/events`
- `GET /v1/sessions/{sessionId}/runs`

`POST .../messages` returning `202` means durable acceptance, not completed
model execution or successful provider delivery.

### SSE Contract

This is deferred from Phase 1. It becomes implementation scope only after a
separate browser identity and access-authority decision is approved.

Keep the existing session event stream and add one app-scoped endpoint:

```text
GET /v1/events
Accept: application/json          # bounded event listing
Accept: text/event-stream         # live stream
```

Supported filters: `afterEventId`, `limit`, `agentId`, `conversationId`,
`threadId`, `sessionId`, `runId`, `jobId`, and repeatable `eventType`.

The endpoint projects the existing `runtime_events` table; it does not create a
new event model. Each envelope contains `eventId`, `eventType`, `createdAt`,
`correlationId`, applicable resource IDs, and a contract-validated payload.

Reconnect behavior is fixed:

1. The UI persists the highest fully applied `eventId` per app.
2. Reconnect sends `afterEventId`; the server also accepts the standard
   `Last-Event-ID` header as a fallback.
3. The server lists persisted rows after that cursor before waiting for new
   events.
4. Postgres `LISTEN/NOTIFY` only wakes subscriptions. Missed notifications are
   recovered by cursor reads.
5. The stream emits a comment heartbeat at least every 15 seconds and honors
   HTTP backpressure.
6. Unknown event types are logged and ignored, then the affected query is
   refetched. Cursor advancement happens only after successful handling.

### Provider WebSocket Boundary

Slack Socket Mode is a provider connection, not an agent socket:

1. The Slack adapter opens Bolt Socket Mode using the server-held app token.
2. Slack messages, mentions, slash commands, and interactive callbacks arrive
   over that connection and are acknowledged promptly.
3. The adapter normalizes the payload into Gantry Conversation, Thread/Topic,
   Message, sender, attachment, and provider-account identifiers.
4. Sender policy, trigger policy, conversation binding, persistence, and live
   admission run through Gantry application services.
5. The selected agent runs without knowing Slack transport details.
6. Agent output returns through channel-neutral delivery contracts; the Slack
   adapter delivers messages and rich interactions through Slack HTTPS APIs.
7. The UI reads canonical messages through REST and observes canonical change
   events through SSE. It never connects to Slack Socket Mode.

Discord Gateway and future provider WebSockets follow the same adapter
isolation. Teams or webhook-based providers may use different inbound
transports without changing browser communication.

### Shared Interactions

An approval or question has one durable `pending_interactions` record even when
rendered in both Slack and the Web UI.

- Every surface references the same interaction ID and allowed actions.
- The UI resolves it with an authenticated HTTP command, never an SSE reply.
- The server verifies app scope, Conversation membership, control-approver
  authority, allowed decision, and current interaction state.
- Resolution is idempotent. The first valid decision wins; later submissions
  receive the stored outcome rather than reopening the interaction.
- The resolution emits a runtime event so all open surfaces update.
- `Allow once` creates only run-lease-scoped transient authority. Persistent
  selections use reviewed capability or granular permission services.

### Access And Permission Authority

The UI presents three distinct operations and must not merge them:

| Operation                                      | Authority path                                                                                                             | Result                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Resolve a live prompt with `Allow once`        | `POST /v1/interactions/{id}/resolve` after Conversation approver validation                                                | A transient grant scoped to the current run lease                                  |
| Select or remove a durable agent capability    | Existing capability catalog and agent access application services, followed by `SettingsDesiredStateService` revision sync | Durable reviewed capability selection reflected in settings and runtime projection |
| List or revoke an existing granular permission | New Control API adapter over the existing `PermissionManagementService` used by admin MCP tools                            | Revokes that exact durable permission without creating a second UI policy store    |

`GET /v1/permissions` is read-only projection. `DELETE
/v1/permissions/{id}` delegates to the existing revoke service and emits the
same audit evidence as other adapters. It cannot create permissions, convert a
transient grant into durable authority, or select capabilities.

## Browser Access Is Deferred

Phase 1 serves a static shell only. It adds no pairing, browser sessions, CSRF,
browser credentials, browser REST, SSE, WebSockets, UI settings, Postgres
security state, Control API route, CLI command, or audit event.

The current Control API remains the future authority, but its bearer tokens do
not enter a browser. A dedicated browser identity and access-authority decision
must define the future transport boundary before any UI route reads or mutates
runtime data.

## Frontend Technical Design

### Stack

- React 19.2, TypeScript, Vite 8, and a code-defined TanStack Router tree.
- TanStack Query, TanStack Table, and Zod begin in Phase 2 after browser
  access is approved.
- Radix primitives and Lucide icons.
- React Hook Form begins in Phase 3 for complex administration forms.
- Gantry-owned `InteractionDescriptor` renderers compose chat presentation;
  `assistant-ui` is not planned.
- Tailwind CSS v4 utilities with CSS custom-property tokens.
- Automated UI test tooling is deferred. Do not add Vitest, Testing Library,
  MSW, Playwright, axe-core, or a frontend test harness in this initiative.

No state library is added for server data. Local UI state stays in component or
route state until a demonstrated cross-route need exists.

Phase 1 installs only the static-shell dependencies: React, TanStack Router,
Lucide, the Radix dialog primitive, and self-hosted Spline fonts. Query, table,
Zod, forms, chat, contract, API, auth, and event dependencies are deferred
until they have an approved browser authority path. Do not add TanStack Form,
Store, DB, Virtual, Start, a router Vite plugin, or a generated route tree.

### Package And Folder Structure

```text
apps/web/
  public/
  src/
    app/                  # code-defined router, shell, navigation
    routes/               # route-level screen composition
    features/             # agents, chat, jobs, providers, workflows, etc.
    ui/
      primitives/         # buttons, fields, menus, dialogs, tables
      compositions/       # headers, split panes, timelines, inspectors
      rich/               # InteractionDescriptor/render_* renderers
    lib/
      api/                # Phase 2 typed client, query keys, errors
      events/             # Phase 2 SSE cursor, reconnect, dispatch
  package.json
  vite.config.ts
```

`apps/web/dist` is generated and untracked. The root build runs the web build
before packaging the Control API static assets. The full Control API process
serves the SPA under `/ui`; API and event routes stay under `/v1`. Development
uses Vite on `5173` with no API proxy in Phase 1 because the browser makes no
runtime requests.

`packages/contracts` owns browser-safe request, response, and event types.
`packages/sdk` stays Node-only; the browser does not import its HTTP transport.

## Design Tokens And Composition

Use the prototype as the visual source while normalizing controls and cards to
a maximum `8px` radius.

### Semantic Color Seeds

| Token role        | Light     | Dark      |
| ----------------- | --------- | --------- |
| Background        | `#f2f1ee` | `#131211` |
| Surface           | `#ffffff` | `#1d1c1a` |
| Surface secondary | `#f9f8f6` | `#242220` |
| Surface tertiary  | `#edebe7` | `#2b2926` |
| Text              | `#1b1a18` | `#f0eeea` |
| Text secondary    | `#555350` | `#b5b1aa` |
| Muted             | `#8b8881` | `#807c75` |
| Border            | `#e6e4df` | `#2c2a27` |
| Strong border     | `#d4d1cb` | `#3b3833` |
| Signal            | `#8a6a3c` | `#c0985f` |
| Signal soft       | `#f1e7d6` | `#2f2820` |
| Success           | `#5d7f58` | `#84a87e` |
| Success soft      | `#e2ebdf` | `#222b20` |
| Danger            | `#a85439` | `#c97f63` |
| Danger soft       | `#f2e0d8` | `#32231d` |

Define component aliases such as `--control-bg`, `--focus-ring`,
`--status-running`, and `--chart-*` from semantic tokens rather than using seed
colors directly in feature components.

### Remaining Tokens

- Typography: Spline Sans for UI, Spline Sans Mono for IDs, timestamps, logs,
  and code; roles at 10, 11.5, 13.5, 14, 18, and 26 pixels.
- Spacing: 2, 4, 6, 8, 12, 16, 20, 24, and 32 pixels.
- Radius: 4px controls, 6px repeated items, 8px cards/dialogs.
- Motion: 120ms direct feedback and 180ms overlays; disable nonessential motion
  under `prefers-reduced-motion`.
- Breakpoints: 640px, 900px, and 1200px. Typography does not scale with viewport
  width.
- Stable control sizes: 32px compact, 36px default, and 40px touch-oriented.

### Reusable Compositions

Build `AppShell`, `PageHeader`, `DataTable`, `SplitPane`, `Inspector`,
`Timeline`, `Dialog`, `EmptyState`, `ErrorState`, `ConnectionState`,
`ChatThread`, and `InteractionRenderer`. Feature routes compose these pieces;
they do not fork their own shells, tables, interaction cards, or status styles.

Desktop uses a restrained sidebar and dense work surfaces. Below 900px,
inspectors become drawers and split panes become routed or tabbed views. Below
640px, navigation becomes a drawer, table rows gain a compact detail view, and
primary actions remain reachable without horizontal scrolling.

All controls require keyboard operation, visible focus, meaningful labels,
WCAG AA contrast, reduced-motion support, and non-color status cues.

## Route And API Composition

Prototype screens that represent tabs, dialogs, drawers, empty states, or run
states are composed inside these routes instead of becoming separate pages.

| Route                 | UI responsibility                                                   | Existing APIs to reuse                                                              | Required addition                                                                        |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/overview`           | Health, usage, active work, waiting interactions                    | status, health, doctor, usage, jobs, runs                                           | app event stream, session list, pending-interaction list                                 |
| `/providers`          | Provider accounts, readiness, discovery                             | providers, provider accounts, conversation discovery                                | browser-safe secret submission flow where current credential route is insufficient       |
| `/conversations/:id?` | Conversations, threads, messages, policies, installs                | conversations, approvers, threads, messages, conversation installs                  | live conversation event projection                                                       |
| `/agents/:id?`        | Identity, model, profile, sources, capabilities, access, pause      | agents, models, profile files, inventory, capabilities, skills, MCP servers, access | no parallel agent service; add only missing projections discovered during implementation |
| `/chat/:sessionId`    | Session list, messages, streaming, interactions, runs, memory       | session ensure/get/messages/events/runs, memory                                     | session list and interaction resolve APIs                                                |
| `/jobs/:id?`          | Definitions, blockers, runs, events, notifications                  | jobs, job events, runs                                                              | none unless UI acceptance exposes a documented contract gap                              |
| `/activity`           | Filterable audit and runtime history                                | runtime events and existing audit repositories                                      | paginated activity read model                                                            |
| `/diagnostics`        | Health, doctor, guided remediation, provider readiness              | status, health, doctor, guided actions                                              | no duplicate diagnostic engine                                                           |
| `/runtime/*`          | Models, memory, usage, capacity, queue, sandbox, egress, guardrails | models, credentials, usage, memory, desired settings                                | browser-safe settings projections only                                                   |
| `/people/:id?`        | Users, aliases, invitations, merge                                  | existing user and alias domain storage                                              | public people application service and API                                                |
| `/workflows/:id?`     | Definitions, versions, validation, runs, external steps             | job/run primitives only where semantics match                                       | workflow application service, storage, contracts, and API                                |
| `/profile`            | Owner profile and UI preferences                                    | current settings/profile projections where applicable                               | add only explicitly owned profile fields                                                 |

Every route defines loading, empty, partial-data, error, unauthorized, stale,
reconnecting, and offline behavior. Mutations display optimistic state only when
the operation is safely reversible; authority-changing actions wait for the
server result.

## Required Public Interfaces

Add contracts and routes only when their phase begins:

| Surface      | Minimum interface                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| App events   | `GET /v1/events` as JSON or SSE with cursor and resource filters                                        |
| Sessions     | `GET /v1/sessions` with pagination and agent/conversation/status filters                                |
| Interactions | `GET /v1/interactions`; `POST /v1/interactions/{id}/resolve`                                            |
| Permissions  | `GET /v1/permissions`; `DELETE /v1/permissions/{id}` over the same services used by admin MCP tools     |
| Activity     | `GET /v1/activity` with cursor pagination and actor/resource/event filters                              |
| People       | user list/detail, aliases, invitation creation/status, and atomic merge commands under `/v1/users`      |
| Workflows    | definitions, immutable versions, validation, enable/disable, runs, and run events under `/v1/workflows` |

New public shapes must be added to `packages/contracts`, represented in OpenAPI,
and covered by contract tests. Route handlers remain adapters over application
services; CLI, Control API, and Gantry MCP must not each implement business
rules independently.

## Data Ownership Rules

- Browser identity and access security state are deferred pending a dedicated
  design; Phase 1 stores no browser session or credential state.
- Agent identity, defaults, sources, capabilities, provider accounts,
  conversations, policies, approvers, and bindings remain revision-owned
  desired state where already defined as such.
- Runtime events, sessions, messages, runs, jobs, usage, interactions, audit,
  workflow runs remain Postgres runtime state.
- Non-secret UI configuration writes `settings.yaml`, appends
  `settings_revisions`, and reconciles runtime projection in one operation.
- The browser reads runtime settings through `GET /v1/settings` and reads or
  mutates desired state through the existing `GET|PUT|POST
/v1/settings/desired-state` surface with `expectedRevision`. `PATCH
/v1/settings` remains read-only and must continue returning
  `SETTINGS_READ_ONLY`. Add the existing desired-state surface to OpenAPI and
  browser-safe contracts rather than inventing another settings route.
- Runtime secrets use `RuntimeSecretProvider`; agent credentials use
  `AgentCredentialBroker`. The UI submits secrets only to dedicated write-only
  server forms and receives redacted readiness metadata.
- Conversation approvers remain the only user-facing approval policy. The UI
  cannot invent UI-only approvers or bypass membership verification.

## Implementation Phases

Each phase is delivered independently. Its focused checks run before the next
phase; the full repository gates run at the phase boundary.

### Phase 1: Static Foundation And Hosting

Dependencies: none beyond the existing Control server and static asset packaging.

Deliver:

- `apps/web` workspace, router, shell, tokens, themes, primitives, profile
  preferences, and shared state compositions. UI test harness work is deferred.
- Static SPA packaging at `/ui`, UI-only history fallback, and no development
  proxy or browser-to-server transport.
- No browser pairing/session/CSRF, API client, Query provider, contracts,
  Postgres schema, Control API route, CLI command, audit event, or SSE work.

Accept when direct route refresh, theme/motion persistence, static hosting, and
desktop/mobile shell checks pass through manual local verification. Cleanup:
search for browser transport, browser credentials, and tracked build output.

### Phase 2: Operational Console

Dependencies: Phase 1 app shell plus an approved browser-access design. Phase
2 introduces the browser API client, TanStack Query, TanStack Table, Zod search
schemas, query-key factories, and the SSE coordinator.

Deliver overview, waiting interactions, providers, conversations, approval
policy, and diagnostics using current APIs. Add session-list and
interaction-list/resolve routes through existing services.

Accept when an operator can discover a provider conversation, inspect its
messages and policy, see a pending interaction, resolve it, and observe every
view converge after the resolution event. Cleanup: search for provider-native
payloads and route-local status variants.

### Phase 3: Agent Administration

Dependencies: Phase 2 Query/Table/search foundations. Phase 3 introduces React
Hook Form for complex administration forms.

Deliver agent list/detail, identity/model/profile editing, sources,
capabilities, skills, MCP servers, access, conversation installs, and pause
state. Every settings-owned mutation uses revision-aware optimistic concurrency
and displays the resulting revision.

Accept when agent changes survive restart, `settings.yaml` matches the latest
revision, profile files use protected profile services, and no UI path writes
files or Postgres directly. Cleanup: search for raw model IDs, provider-specific
agent flags, and direct settings writes.

### Phase 4: Chat And Rich Interactions

Dependencies: the approved browser-access design and Phase 2 Query/SSE and
interaction APIs.

Deliver session list, chat thread, composer, streaming presentation, runs,
files, questions, approvals, todo/progress, and every supported rich descriptor
kind. Throttle visual streaming updates without dropping durable events.

Accept when a full turn can be submitted, streamed, interrupted by a durable
question or permission, resolved from either UI or provider surface, resumed,
and completed after an SSE disconnect/reconnect. Cleanup: search for text-prefix
reasoning filters and duplicate rich schemas.

### Phase 5: Jobs, Runtime, Usage, And Activity

Dependencies: shared tables, timelines, and event coordinator.

Deliver jobs/runs/blockers, usage, models, memory, queue/capacity, sandbox,
egress, guardrails, diagnostics detail, and paginated activity. Reuse current
job, usage, model, memory, settings, and run contracts; add only the activity
read model.

Accept when lifecycle changes and blockers update live, settings mutations use
revision authority, and event/audit detail is inspectable without exposing
secrets. Cleanup: search for raw pg-boss concepts and UI-owned policy logic.

### Phase 6: People

Dependencies: conversations and shared form/table patterns.

Deliver user list/detail, provider aliases, invite status, and merge preview and
confirmation through new application services over existing user/alias domain
concepts.

Accept when merge is atomic, preserves audit/provenance, rejects unsafe
conflicts, and refreshes affected conversations without manual reload. Cleanup:
search for UI-only identity records and provider IDs treated as interchangeable.

### Phase 7: Workflows

Dependencies: agents, capabilities, jobs/runs, interactions, and activity.

Deliver workflow definitions, immutable versions, validation, enable/disable,
run detail, external-step status, honest-limit states, and audit history.
Workflow execution reuses Gantry permission, capability, run, interaction, and
notification services; it does not grant tools from workflow input.

Accept when a draft validates into an immutable version, an enabled version can
run, blocked capability requirements show one clear action, and every terminal
run leaves durable evidence. Cleanup: search for workflow-owned permission or
scheduler engines.

### Phase 8: Hardening And Release

Dependencies: all shipped product phases.

Deliver mobile and tablet refinements, manual keyboard audit, dark-theme visual
QA, event-load performance, security review, production packaging, docs, and
rollout controls. Add browser identity/access work only after it has separately
been designed and approved.

Accept when desktop and mobile manual checks pass in both themes, no page
overflows or overlaps, forced reconnect works, no secret appears in browser
storage or responses, and applicable Gantry gates pass. Cleanup:
search for prototype code, temporary mocks, stale route names, and deferred
feature flags without owners.

## Test And Verification Strategy

Automated UI testing is deferred by product decision. Do not add a frontend
test harness, testing dependencies, test scripts, fixtures, mock server,
browser runner, or accessibility runner in the current UI initiative. Use
manual acceptance checks, cleanup searches, builds, and applicable repository
structural gates. The future test scope is intentionally deferred: Query/cache
behavior, browser contracts, interaction races, route states, accessibility,
responsive end-to-end flows, browser-access security, and streaming
performance. Approve and add their tools only when an implementation phase
requires them.

Run these cleanup searches in their matching phase and review every match. They
are evidence checks, not delete-by-regex instructions.

```bash
# Phase 1
rg -n -e 'localStorage' -e 'sessionStorage' -e 'GANTRY_CONTROL_API' -e 'Bearer ' -e 'dist/ui' apps/web apps/core/src packages --glob '!**/dist/**'
# Phase 2
rg -n -e 'slack_event' -e 'slackPayload' -e 'SocketMode' -e 'xapp-' -e 'providerPayload' -e 'statusColor' apps/web/src
# Phase 3
rg -n -e 'writeFile' -e 'settings\.yaml' -e 'INSERT INTO' -e 'modelId' -e 'providerModelId' -e 'permissionStore' apps/web/src apps/core/src/control
# Phase 4
rg -n -e 'startsWith\(' -e 'includes\(.*thinking' -e 'UISpec' -e 'RichInteractionDescriptor.*interface' -e 'providerPayload' apps/web/src
# Phase 5
rg -n -e 'pg-boss' -e 'pgboss' -e 'yolo_mode' -e 'approve.*tool' -e 'policyEngine' apps/web/src
# Phase 6
rg -n -e 'slackUserId' -e 'teamsUserId' -e 'telegramUserId' -e 'discordUserId' -e 'peopleStore' apps/web/src apps/core/src/application
# Phase 7
rg -n -e 'WorkflowPermission' -e 'WorkflowScheduler' -e 'grantCapability' -e 'enableTool' -e 'pg-boss' apps/core/src apps/web/src
# Phase 8
rg -n -e 'TODO' -e 'FIXME' -e 'mock' -e 'prototype' -e 'legacy' -e 'compat' -e 'featureFlag' apps/web apps/core/src/control packages/contracts/src
```

Focused checks run after each packet. Every implementation phase closes with:

```bash
npm run build
npm test
python3 .codex/scripts/check_architecture.py
python3 .codex/scripts/check_task_completion.py
python3 .codex/scripts/validate_artifacts.py --allow-missing-run
python3 .codex/scripts/verify.py
```

Database-backed checks use a disposable Postgres instance with the required
`vector`, `pg_trgm`, and public `pgcrypto` extensions.

## Surface Impact Matrix

| Surface                      | Classification      | Implementation effect                                                                                                                                   |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime behavior             | Changed             | Serve static `/ui` assets from the existing Control process.                                                                                             |
| `settings.yaml`              | Unchanged by design | Static hosting introduces no UI runtime setting or browser authority.                                                                                     |
| Postgres/runtime projection  | Unchanged by design | No browser session, audit, or event persistence is added.                                                                                                |
| Control API                  | Unchanged by design | Existing routes and bearer authentication remain unchanged.                                                                                               |
| SDK/contracts                | Unchanged by design | No browser-facing API contract exists in the static-only phase.                                                                                           |
| CLI                          | Unchanged by design | No pairing or UI CLI command is added.                                                                                                                    |
| Gantry MCP tools/admin skill | Unchanged by design | The Web UI is an owner/admin adapter; existing MCP tools keep agent-requested reviewed flows and do not gain authority merely for UI parity.            |
| Channel/provider adapters    | Unchanged by design | Slack and other adapters retain provider transport and rendering ownership; the UI consumes canonical state and events.                                 |
| Docs/prompts                 | Changed             | Record the static-only boundary, implementation plan, tracker, and operator guidance.                                                                    |
| Audit/events                 | Unchanged by design | Browser actions and event streaming are deferred with browser access.                                                                                    |
| Tests/verification           | Deferred            | User requested no automated UI tests, harness, or testing dependencies for now; use manual checks, cleanup searches, builds, and structural gates only. |

Browser identity, SSO, REST, SSE, and WebSockets are deferred pending one
dedicated browser-access design. The static shell never receives an API key or
runtime credential.

## Planning-Change Verification

For this documentation-only branch, verify only the changed artifact:

```bash
npx prettier --check docs/architecture/gantry-web-ui-implementation-plan.md
git diff --check
python3 .codex/scripts/check_architecture.py
python3 .codex/scripts/check_task_completion.py
git status --short
```

The planning change is complete when this Markdown file is the only diff, all
links and repo-relative paths are valid, existing and proposed APIs are clearly
distinguished, and no implementation code or generated output is present.
