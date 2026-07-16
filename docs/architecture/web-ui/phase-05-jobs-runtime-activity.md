# Phase 5: Jobs, Runtime, And Activity

## Goal

Build complete job, run, usage, runtime, and activity surfaces from redacted
preview records without creating a browser scheduler or policy engine.

## Screens

| Screen        | Major sections and local actions                                                 |
| ------------- | -------------------------------------------------------------------------------- |
| Jobs          | Definitions, status, blocker action, schedule, notification routes, recent runs. |
| Run detail    | Outcome, timeline, receipts, files, blocker context, connection-gated controls.  |
| Models        | Alias catalog, harness compatibility, readiness, usage summary.                  |
| Memory engine | Pipeline status, stores, review queue, retention summary.                        |
| Capacity      | Active work, queue, concurrency, usage and budget indicators.                    |
| Guardrails    | Sandbox, egress, permission and denylist summaries with redacted detail.         |
| Activity      | Searchable cursor-style timeline, actor/resource/type filters, inspector.        |

## Implementation

1. Add job/run/runtime/activity view models, redacted fixtures, Query keys,
   controlled Table state, and route search schemas.
2. Compose `/jobs`, `/jobs/:id`, `/activity`, and all `/runtime/*` routes from
   shared tables, metrics, timelines, detail sections, and state compositions.
3. Keep runtime policy and secret interpretation in fixtures, not component
   conditionals. Do not expose raw leases, tokens, provider payloads, or rules.
4. Route trigger, pause, retry, cancel, model-change, memory-review, and policy
   commands through the shared connection gate.

## Acceptance

- Every blocker presents one clear next action and never implies it succeeded.
- Filters and pagination remain stable through refresh and narrow layouts.
- Runtime views are readable and redacted at all target viewports.
- No scheduler library, policy engine, event store, or persisted cache is added.

Run web typecheck, lint, build, direct-refresh/browser checks, long-list and
overflow review, redaction/transport cleanup searches, and `git diff --check`.

## Surface Impact And Handoff

| Surface                                         | Status              | Reason                                               |
| ----------------------------------------------- | ------------------- | ---------------------------------------------------- |
| Runtime behavior                                | Changed             | Preview job, runtime, and activity routes are added. |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | Runtime records are display-only.                    |
| MCP/admin, providers, audit/events              | Unchanged by design | No policy or authority change.                       |
| Docs                                            | Changed             | Record screens and QA evidence.                      |
| Tests/verification                              | Deferred            | Automated UI tests remain deferred.                  |

Phase 6 may link people to conversations and activity but cannot reinterpret
provider aliases or create a second timeline model.
