# Phase 2: Component System And Operations Console

## Goal

Maintain the shared UI system and connect only Operations surfaces supported by
canonical existing APIs through the guarded local-owner transport.

## Current Screen Boundary

| Screen         | Current behavior                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Component lab  | Development-only primitive, overlay, state, table, and renderer coverage.                       |
| Conversations  | Live provider accounts, conversations, threads, messages, approvers, agents, and installations. |
| Overview       | Preview composition pending a sanitized aggregate read model.                                   |
| Waiting on you | Preview composition pending interaction list/resolve APIs.                                      |
| Providers      | Preview composition; channel connection administration is not part of this rollout.             |
| Diagnostics    | Preview composition pending a browser-safe diagnostics projection.                              |

## Implemented Conversation Flow

1. Load provider accounts, canonical conversations, agents, and each agent's
   conversation installations through domain-owned Query keys.
2. Map canonical `active`, `inactive`, and `archived` statuses into the table.
3. Use Reload for ordinary Query refresh and a separate explicit provider
   discovery action.
4. Load detail messages, threads, and approvers from existing endpoints.
5. Replace approvers through the server membership validator.
6. Replace agent installations through existing revision-aware application
   services and settings synchronization.
7. Display member counts, provider activity, and policy fields as unavailable
   when the current contract does not provide them.

## Acceptance

- Disabled mode starts no conversation queries.
- Discovery runs only after an explicit provider-account action.
- Approver and install mutations invalidate canonical conversation Query keys.
- No direct database, filesystem, provider SDK, or settings write exists in
  browser code.
- No preview record appears as fallback after a live conversation request
  fails.
- Component and route files remain at or below 350 lines.

Run web typecheck, lint, build, direct-refresh checks, responsive browser QA,
storage/network cleanup searches, and `git diff --check`. Automated UI tests
remain deferred.

## Surface Impact And Handoff

| Surface                     | Status               | Reason                                                                                      |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Runtime behavior            | Changed              | Conversations may issue local-owner reads and reviewed mutations while the route is open.   |
| `settings.yaml`             | Read-only/observable | Existing install/approver services retain revision and file synchronization authority.      |
| Postgres/runtime projection | Read-only/observable | Existing projections are read and existing services own mutations.                          |
| Control API                 | Read-only/observable | Existing provider/conversation/agent routes are reused through the guarded bridge.          |
| SDK/contracts               | Unchanged by design  | Browser validation and view models remain private to `apps/web`.                            |
| CLI and MCP/admin           | Unchanged by design  | No new administration adapter is introduced.                                                |
| Channel/provider adapters   | Read-only/observable | Discovery and message projections remain provider-owned server behavior.                    |
| Docs                        | Changed              | Record the connected/deferred Operations boundary.                                          |
| Audit/events                | Read-only/observable | Existing mutation audit behavior is preserved.                                              |
| Tests/verification          | Changed              | Bridge tests and manual UI checks cover the local boundary; UI automation remains deferred. |

Phase 3 may reuse the shared components and transport, but must not create
feature-local authority or parallel caches.
