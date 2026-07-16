# Phase 5: Jobs, Runtime, And Activity

## Goal

Expose durable runtime evidence without browser-owned policy or secrets. Reuse
job, run, usage, model, memory, and desired-state services; add only the
paginated activity read model.

## Dependencies And Exclusions

Dependencies: Phase 2 Query/Table/search foundations, shared timelines, SSE
coordinator, job/run/usage/model services, and desired-state APIs. Excluded: a
browser policy engine, raw scheduler internals, a second event store, and secret
display.

## Screens

| Screen    | Major sections and actions                                                                 |
| --------- | ------------------------------------------------------------------------------------------ |
| Jobs/runs | Definitions, status, blockers, notifications, timeline, one clear blocker action.          |
| Runtime   | Models, memory, usage, capacity, queue, sandbox, egress, guardrails, redacted diagnostics. |
| Activity  | Cursor timeline with actor, resource, and event-type filters.                              |

## Steps

1. Compose job/run and runtime routes from server projections; hide raw lease
   and scheduler internals.
2. Add `/v1/activity` cursor contract over existing runtime/audit repositories.
3. Use SSE to invalidate summaries, then fetch detail by ID. Browser code does
   not infer policy, readiness, or secret values.
4. Route settings-owned changes through desired-state revision APIs.

Use controlled Table state and TanStack Query cursor/infinite-query patterns for
activity and list screens. Do not add TanStack Virtual unless Phase 8 measures a
real render bottleneck.

## Acceptance And Checks

- Lifecycle/blockers update live and missing capabilities show one safe action.
- Cursor/filter activity is stable and redacted; queue/sandbox/egress views do
  not expose secrets or become the policy engine.

```bash
rg -n -e 'pg-boss' -e 'pgboss' -e 'yolo_mode' -e 'approve.*tool' -e 'policyEngine' apps/web/src
```

Automated UI tests remain deferred. Verify the acceptance paths manually and
run the repository build and structural gates for the implementation change.

## Surface Impact And Handoff

| Surface                                                                | Status              | Reason                                          |
| ---------------------------------------------------------------------- | ------------------- | ----------------------------------------------- |
| Runtime, settings, Postgres, API, contracts, audit/events, docs        | Changed             | Add activity projection and safe runtime UI.    |
| Tests                                                                  | Deferred            | No automated UI harness exists until approved.  |
| CLI, MCP/admin, providers                                              | Unchanged by design | Existing authority and transport remain intact. |

Phase 6 can link people to activity and Conversations without changing alias
provenance.
