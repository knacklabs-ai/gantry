# Gantry Web UI Implementation Plan

## Goal

Deliver the complete Gantry operator and end-user interface now, using typed
preview data until browser access and server contracts are approved. The UI
must be stable, responsive, reusable, and honest about its disconnected state.

## Product Boundary

- `apps/web` is a separately built React application served by the existing
  Gantry process at `/ui`.
- The shell always shows `Preview data` and `Not connected` while preview
  records are rendered.
- Local navigation, filters, sorting, pagination, tabs, inspectors, drawers,
  validation, and drafts work normally.
- A server-owned command opens `Connect Gantry to continue`, preserves the
  local draft, sends no request, and never changes preview data.
- Authentication, accounts, roles, OAuth/OIDC, SAML, SSO, REST, SSE,
  WebSockets, Control API changes, persistence, and audit events are deferred.
- Browser storage is limited to the versioned appearance and motion preference.

## Frontend Architecture

- React 19, Vite, TypeScript, Tailwind CSS v4, and a code-defined TanStack
  Router tree remain the application foundation.
- TanStack Query owns memory-only preview reads and canonical screen states.
- TanStack Table owns operational tables and controlled pagination/filtering.
- Zod validates route search parameters and local draft schemas.
- React Hook Form owns complex agent and workflow drafts.
- Radix provides accessible behavior for overlays and complex controls; Gantry
  owns their Tailwind presentation.
- Product areas are lazy-loaded. Feature modules own their view models,
  fixtures, queries, route components, and feature-specific compositions.
- Shared primitives and compositions live under `ui`; narrow browser helpers
  live under `lib`. Direct imports are preferred over barrel files.
- No global feature store, Storybook, chart library, virtualization, API client,
  auth package, or automated UI test harness is introduced.

## Visual Contract

The standalone Gantry prototype remains the visual source of truth: compact
operator density, Spline Sans and Spline Sans Mono, warm neutral surfaces,
near-monochrome controls, bronze only for human attention, and green/red only
for semantic state. Cards and controls use at most an 8px radius. Focus is
visible, dimensions are stable, and reduced motion is respected.

## Route Map

| Area         | Routes                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Foundation   | `/ui`, `/profile`, development-only `/__components`                                                        |
| Operations   | `/overview`, `/interactions`, `/providers`, `/conversations/*`, `/diagnostics`                             |
| Agents       | `/agents/*`, `/sources`                                                                                    |
| Chat         | `/chat/*`, `/memory`                                                                                       |
| Jobs/runtime | `/jobs/*`, `/activity`, `/runtime/models`, `/runtime/memory`, `/runtime/capacity`, `/runtime/guardrails`   |
| People       | `/people/*`                                                                                                |
| Workflows    | `/workflows`, `/workflows/new`, `/workflows/:id/edit`, `/workflows/:id/runs/:runId`, `/workflows/external` |

The desktop shell uses grouped sidebar navigation. Tablet detail opens in an
inspector drawer. Mobile uses the navigation drawer and routed detail screens.

## Delivery Contract

1. Preserve and verify the completed static foundation and `/ui` packaging.
2. Build semantic tokens and a development-only component lab.
3. Compose Operations, Agents, Chat, Jobs/runtime, People, and Workflows in
   their existing phase order.
4. Add populated, loading, empty, partial, error, offline, reconnecting, and
   not-connected states through shared compositions.
5. Verify each packet before committing it. Do not accumulate unrelated screen
   areas in one commit.

Every handwritten UI source file stays at or below 350 lines. Changes are made
and reviewed one file at a time.

## Verification

- `npm run typecheck:web`
- `npm run lint:web`
- `npm run build:web`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- direct-refresh and interaction checks in Chrome
- visual checks at 1440px, 1024px, and 390px in light and dark themes
- keyboard, focus-return, overflow, long-text, and reduced-motion checks
- cleanup searches for network clients, credentials, unexpected storage,
  duplicate components, and files over 350 lines

Automated UI tests remain deferred by user decision and cannot be cited as a
release gate. Existing unrelated core architecture findings are recorded, not
changed by this UI plan.

## Surface Impact Matrix

| Surface                     | Classification      | Reason                                                                  |
| --------------------------- | ------------------- | ----------------------------------------------------------------------- |
| Runtime behavior            | Changed             | Gantry serves the complete preview-backed `/ui` application.            |
| `settings.yaml`             | Unchanged by design | The disconnected UI cannot change runtime settings.                     |
| Postgres/runtime projection | Unchanged by design | Preview records are memory-only.                                        |
| Control API                 | Unchanged by design | Browser transport remains deferred.                                     |
| SDK/contracts               | Unchanged by design | UI view models remain private.                                          |
| CLI                         | Unchanged by design | No UI setup command is introduced.                                      |
| Gantry MCP/admin            | Unchanged by design | Preview actions grant no authority.                                     |
| Channel/provider adapters   | Unchanged by design | Provider transport remains server-side.                                 |
| Docs/prompts                | Changed             | Parent, phase, and tracking documents describe frontend-first delivery. |
| Audit/events                | Deferred            | No authoritative browser action exists yet.                             |
| Tests/verification          | Deferred            | Automated tests are deferred; builds and browser QA are required.       |
