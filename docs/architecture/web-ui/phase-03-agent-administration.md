# Phase 3: Agent Administration

## Goal

Compose complete agent administration and Sources & Access screens from
preview records while keeping every durable command behind the connection gate.

## Screens

| Screen           | Major sections and local actions                                                     |
| ---------------- | ------------------------------------------------------------------------------------ |
| Agent list       | Search, status/model filters, assignments, selection, create action.                 |
| Agent detail     | Identity, model, profile, sources, capabilities, skills, MCP, access, conversations. |
| Sources & Access | Catalog, selected sources, capability readiness, blockers, review context.           |
| Pause everywhere | Impact summary, affected agents/conversations, connection-gated confirmation.        |

## Implementation

1. Add feature-owned agent/source view models, preview fixtures, Query keys,
   route search schemas, and local form schemas.
2. Use React Hook Form for multi-section drafts and shared field/section/error
   compositions; keep unsaved values in memory only.
3. Compose `/agents`, `/agents/:id`, and `/sources` with stable tabs and
   responsive list/detail layouts.
4. Model aliases, harnesses, sources, skills, MCP, and capabilities with
   provider-neutral display vocabulary. Never expose credentials or raw IDs.
5. Route create, save, pause, resume, attach, grant, and revoke through the
   shared connection gate without mutating preview records.

## Acceptance

- Local drafts validate, retain values after the connection gate closes, and
  reset only on explicit reset or page reload.
- Agent/source tabs, filtering, selection, and inspectors work at all target
  viewports and in both themes.
- No filesystem, settings, SQL, Control API, credential, or provider-specific
  code appears in `apps/web`.

Run web typecheck, lint, build, direct-refresh/browser checks, line-count and
storage/network cleanup searches, and `git diff --check`.

## Surface Impact And Handoff

| Surface                                         | Status              | Reason                                     |
| ----------------------------------------------- | ------------------- | ------------------------------------------ |
| Runtime behavior                                | Changed             | Agent and source preview routes are added. |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | Drafts are local and commands are blocked. |
| MCP/admin, providers, audit/events              | Unchanged by design | UI records are display-only.               |
| Docs                                            | Changed             | Record screens and QA evidence.            |
| Tests/verification                              | Deferred            | Automated UI tests remain deferred.        |

Phase 4 may reuse agent and conversation selectors but cannot create another
form, capability, or action-boundary system.
