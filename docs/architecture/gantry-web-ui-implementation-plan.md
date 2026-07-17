# Gantry Web UI Implementation Plan

## Goal

Deliver the Gantry interface with an AWS-safe connection boundary. Production
and remote deployments remain disconnected by default; a workstation may
explicitly enable loopback-only local-owner access to existing Control APIs.

## Product Boundary

- `apps/web` is a separately built React application served by the existing
  Gantry process at `/ui`.
- The shell reads `/ui/runtime-config.json` before mounting runtime queries.
- `disabled` mode shows `Not connected` and makes no runtime request.
- `local-owner` mode uses the loopback-only `/ui-api/v1` bridge. The bridge
  keeps its dedicated scoped Control key outside the browser.
- Local navigation, filters, sorting, pagination, tabs, inspectors, drawers,
  validation, and drafts work normally.
- Models, jobs/runs, memory, conversations, and session chat use existing REST
  APIs. Session chat alone uses fetch-based SSE while its route is active.
- Authentication, accounts, roles, OAuth/OIDC, SAML, SSO, browser WebSockets,
  remote UI access, and workflow execution remain deferred.
- Workflow definitions remain unavailable until their separately reviewed
  contracts, Postgres migration, and API rollout are approved for AWS.
- Browser storage is limited to the versioned appearance and motion preference.

## Frontend Architecture

- React 19, Vite, TypeScript, Tailwind CSS v4, and a code-defined TanStack
  Router tree remain the application foundation.
- TanStack Query owns in-memory REST snapshots and canonical screen states.
- TanStack Table owns operational tables and controlled pagination/filtering.
- Zod validates route search parameters and local draft schemas.
- React Hook Form owns complex agent and workflow drafts.
- Radix provides accessible behavior for overlays and complex controls; Gantry
  owns their Tailwind presentation.
- Product areas are lazy-loaded. Feature modules own their view models, API
  adapters, queries, route components, and feature-specific compositions.
- Shared primitives and compositions live under `ui`; narrow browser helpers
  live under `lib`. Direct imports are preferred over barrel files.
- A narrow browser transport under `lib/api` is the only direct fetch/SSE
  owner. No global feature store, Storybook, chart library, virtualization,
  browser auth package, or automated UI test harness is introduced.

## Visual Contract

The standalone Gantry prototype remains the visual source of truth: compact
operator density, Spline Sans and Spline Sans Mono, warm neutral surfaces,
near-monochrome controls, bronze only for human attention, and green/red only
for semantic state. Cards and controls use at most an 8px radius. Focus is
visible, dimensions are stable, and reduced motion is respected.

## Route Map

| Area         | Routes                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Foundation   | `/ui`, `/profile`, development-only `/__components`                                                      |
| Operations   | `/overview`, `/interactions`, `/providers`, `/conversations/*`, `/diagnostics`                           |
| Agents       | `/agents/*`, `/sources`                                                                                  |
| Chat         | `/chat/*`, `/memory`                                                                                     |
| Jobs/runtime | `/jobs/*`, `/activity`, `/runtime/models`, `/runtime/memory`, `/runtime/capacity`, `/runtime/guardrails` |
| People       | `/people/*`                                                                                              |
| Workflows    | `/workflows` (unavailable until the separately reviewed workflow rollout)                                |

The desktop shell uses grouped sidebar navigation. Tablet detail opens in an
inspector drawer. Mobile uses the navigation drawer and routed detail screens.

## Delivery Contract

1. Preserve and verify the completed static foundation and `/ui` packaging.
2. Build semantic tokens and a development-only component lab.
3. Connect Models, Jobs/Runs, Memory, and Conversations to existing APIs.
4. Keep unsupported screens visibly unavailable; do not fall back to fixtures
   after a real request fails.
5. Add populated, loading, empty, partial, error, offline, reconnecting, and
   not-connected states through shared compositions.
6. Verify each packet before committing it. Do not accumulate unrelated screen
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
- cleanup searches for browser credentials, unexpected storage, direct feature
  fetches, WebSockets, duplicate components, and files over 350 lines

Automated UI tests remain deferred by user decision and cannot be cited as a
release gate. Existing unrelated core architecture findings are recorded, not
changed by this UI plan.

## Surface Impact Matrix

| Surface                     | Classification       | Reason                                                                 |
| --------------------------- | -------------------- | ---------------------------------------------------------------------- |
| Runtime behavior            | Changed              | Explicit local workstations may connect; AWS remains disabled.         |
| `settings.yaml`             | Unchanged by design  | Local-owner authority is a deployment boundary, not desired state.     |
| Postgres/runtime projection | Read-only/observable | Connected screens read existing projections; no migration is added.    |
| Control API                 | Changed              | Adds runtime discovery and a gated local adapter over existing routes. |
| SDK/contracts               | Unchanged by design  | UI view models remain private.                                         |
| CLI                         | Unchanged by design  | No UI setup command is introduced.                                     |
| Gantry MCP/admin            | Unchanged by design  | Browser actions use existing application services and policy.          |
| Channel/provider adapters   | Read-only/observable | Conversation screens observe existing provider projections.            |
| Docs/prompts                | Changed              | Documents distinguish local, disabled, and future remote modes.        |
| Audit/events                | Read-only/observable | Existing mutations retain their existing audit behavior.               |
| Tests/verification          | Changed              | Add bridge tests and manual UI QA; no UI harness is introduced.        |
