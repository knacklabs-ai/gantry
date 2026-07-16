# Phase 7: Workflows

## Goal

Build workflow definition, drafting, validation, version, run, and external
system screens without introducing a browser workflow engine.

## Screens

| Screen           | Major sections and local actions                                              |
| ---------------- | ----------------------------------------------------------------------------- |
| Definitions      | Search, status/version filters, recent runs, create/open actions.             |
| New workflow     | Template choice, name/owner, honest limits, local validation.                 |
| Builder          | Step palette, ordered canvas, connectors, properties, validation summary.     |
| Draft review     | Changes, capabilities, routes, validation, connection-gated publish.          |
| Run detail       | Step states, timeline, external waits, receipts, files, retry/cancel actions. |
| External systems | Provider readiness, pending external steps, remediation actions.              |

## Implementation

1. Add workflow/step/version/run view models, fixtures, Query keys, route search
   schemas, and React Hook Form/Zod draft schemas.
2. Build shared workflow components with semantic HTML and CSS layout. Do not
   add a diagram engine until real editing requirements prove it necessary.
3. Compose `/workflows`, `/workflows/new`, `/workflows/:id/edit`,
   `/workflows/:id/runs/:runId`, and `/workflows/external`.
4. Allow local add, remove, reorder, configure, and validate behavior in memory.
   Publish, enable, disable, run, retry, cancel, and external remediation use
   the shared connection gate and never create terminal evidence.

## Acceptance

- Draft validation is deterministic and identifies the exact step and field.
- Builder controls remain keyboard accessible and usable at tablet/mobile sizes.
- Preview versions and runs are visibly non-live; commands never fake success.
- No scheduler, permission, notification, execution, or persistence engine is
  implemented in the browser.

Run web typecheck, lint, build, builder/browser checks, reduced-motion and
overflow review, engine/transport cleanup searches, and `git diff --check`.

## Surface Impact And Handoff

| Surface                                         | Status              | Reason                                                |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------- |
| Runtime behavior                                | Changed             | Preview workflow routes and local drafting are added. |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | Drafts are memory-only and commands are blocked.      |
| MCP/admin, providers, audit/events              | Unchanged by design | No execution authority exists.                        |
| Docs                                            | Changed             | Record workflow behavior and evidence.                |
| Tests/verification                              | Deferred            | Automated UI tests remain deferred.                   |

Phase 8 receives every planned screen and focuses only on cross-product
hardening, cleanup, and completion evidence.
