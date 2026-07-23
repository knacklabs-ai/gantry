# Phase 5: Jobs, Runtime, And Activity

## Goal

Connect Models, Jobs/Runs, and Memory Engine to existing APIs while keeping
scheduling, policy, credentials, and event interpretation server-owned.

## Current Screen Boundary

| Screen        | Current behavior                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Models        | Live catalog, aliases, harness compatibility, defaults, readiness, credentials, and 24-hour usage.   |
| Jobs          | Live list/detail, create/update/delete, pause/resume/trigger, runs, and safe event types/timestamps. |
| Memory engine | Live brain counts, memory state, dreaming state, and trigger action.                                 |
| Capacity      | Preview pending a browser-safe runtime-capacity projection.                                          |
| Guardrails    | Preview pending a sanitized policy/egress/sandbox projection.                                        |
| Activity      | Preview pending a paginated sanitized activity read model.                                           |

## Implemented Rules

1. Model forms are generated from server credential-mode fields. Secret inputs
   are never prefilled, cached, logged, serialized, or persisted and reset on
   success, failure, provider/mode change, and close.
2. Fabricated model cost data is removed. Usage shows canonical request and
   token aggregates only.
3. Job mutations reuse existing scheduler application services. The browser
   does not schedule or interpret runtime payloads.
4. Poll only a selected active run every four seconds and stop at a terminal
   state.
5. Run timelines render safe event type and timestamp fields only. Retry,
   cancel, receipt, artifact, and download controls remain hidden.
6. Memory overview remains count/status oriented. Memory content appears only
   in the dedicated list/search screen.
7. Unsupported review, retention, cost, and pipeline claims are shown as
   unavailable or removed.

## Acceptance

- Disabled mode starts no runtime queries, polling, or background work.
- Read retries are bounded; mutations are never retried automatically.
- Job polling exists only while an active run detail is selected.
- Credential values do not appear in assets, storage, URLs, logs, query data,
  or error messages.
- One clear action is shown for a canonical job blocker.
- No raw runtime event payload is rendered.

Run web typecheck, lint, build, direct-refresh/browser checks, long-list and
overflow review, redaction/transport cleanup searches, and `git diff --check`.

## Surface Impact And Handoff

| Surface                     | Status               | Reason                                                                                |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Runtime behavior            | Changed              | Selected local routes may issue existing reads/mutations and bounded run polling.     |
| `settings.yaml`             | Read-only/observable | Existing model default and credential services retain desired-state authority.        |
| Postgres/runtime projection | Read-only/observable | Existing job/run/memory projections are reused; no migration is added.                |
| Control API                 | Read-only/observable | Existing model, credential, usage, job, run, and memory routes are reused.            |
| SDK/contracts               | Unchanged by design  | Browser schemas and view models remain private.                                       |
| CLI and MCP/admin           | Unchanged by design  | No parallel runtime administration adapter is added.                                  |
| Channel/provider adapters   | Unchanged by design  | Runtime screens do not change provider transport behavior.                            |
| Docs                        | Changed              | Record live and preview-only runtime boundaries.                                      |
| Audit/events                | Read-only/observable | Existing mutation audit and safe run event envelopes are reused.                      |
| Tests/verification          | Changed              | Focused bridge tests, builds, redaction searches, and manual browser QA are required. |

Phase 6 may link approved identity records later but must not reinterpret
provider aliases as browser-owned people.
