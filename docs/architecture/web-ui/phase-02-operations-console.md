# Phase 2: Component System And Operations Console

## Goal

Build the shared UI system first, prove it in a development-only component
lab, then compose the complete Operations console from typed preview data.

## Screens

| Screen         | Major sections and local actions                                                         |
| -------------- | ---------------------------------------------------------------------------------------- |
| Component lab  | Primitives, overlays, forms, tables, states, timelines, rich renderers, workflow parts.  |
| Overview       | Setup blockers, health, conversations, agents, people, runs, usage, drill-in navigation. |
| Waiting on you | Pending approvals/questions, filters, context inspector, connection-gated decisions.     |
| Providers      | Account readiness, discovery status, credential readiness, provider detail.              |
| Conversations  | Searchable table, messages, threads, policy, approvers, installed agents.                |
| Diagnostics    | Health checks, findings, redacted details, remediation actions.                          |

## Implementation

1. Add Query, Table, Zod, React Hook Form, and only the Radix dependencies
   exercised by the complete UI. Query data is memory-only.
2. Expand Tailwind semantic tokens and implement the shared connection gate.
3. Build `/__components` only in Vite development and cover every shared state.
4. Add feature-owned Operations view models, fixtures, query keys, and route
   search schemas. Do not create public contracts or an API client.
5. Compose `/overview`, `/interactions`, `/providers`, `/conversations/*`, and
   `/diagnostics`; lazy-load route screens by product area.

## Acceptance

- Tables filter, sort, paginate, and preserve shareable search state.
- Desktop list/detail, tablet drawer, and mobile routed detail remain usable.
- `Preview data` and `Not connected` are always visible.
- Provider setup and interaction decisions open the shared connection gate,
  preserve context, send no request, and do not change preview records.
- Component and route files remain at or below 350 lines.

Run web typecheck, lint, build, direct-refresh checks, browser QA at 1440px,
1024px, and 390px in both themes, storage/network cleanup searches, and
`git diff --check`. Automated UI tests remain deferred.

## Surface Impact And Handoff

| Surface                                         | Status              | Reason                                                            |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| Runtime behavior                                | Changed             | Preview-backed Operations routes and shared components are added. |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | The UI is disconnected and memory-only.                           |
| MCP/admin, providers, audit/events              | Unchanged by design | No authority or transport changes.                                |
| Docs                                            | Changed             | Record UI behavior and evidence.                                  |
| Tests/verification                              | Deferred            | Automated tests remain deferred; browser QA is required.          |

Phase 3 reuses the component system, tables, forms, inspectors, and connection
gate without creating feature-local alternatives.
