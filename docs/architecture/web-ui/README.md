# Gantry Web UI Delivery

These documents define delivery of the Gantry operator UI.
The React application is built in `apps/web` and served by the existing Gantry
process at `/ui`.

## Delivery Order

1. [Foundation and hosting](./phase-01-foundation-hosting.md)
2. [Operations console](./phase-02-operations-console.md)
3. [Agent administration](./phase-03-agent-administration.md)
4. [Chat and rich interactions](./phase-04-chat-rich-interactions.md)
5. [Jobs, runtime, and activity](./phase-05-jobs-runtime-activity.md)
6. [People](./phase-06-people.md)
7. [Workflows](./phase-07-workflows.md)
8. [Hardening and release](./phase-08-hardening-release.md)

Progress is recorded in [the UI implementation tracker](./ui-implementation-tracker.md).

## Current Boundary

- Production and remote deployments use disconnected mode and make no runtime
  request from the browser.
- An explicitly enabled workstation may use the loopback-only `/ui-api/v1`
  bridge. Its dedicated scoped Control key remains server-side.
- Models, jobs/runs, memory, conversations, and session chat use existing APIs.
- Browser auth, remote REST, browser WebSockets, user identity, and workflow
  execution remain deferred.
- Workflow definitions require a separate AWS-reviewed contracts, migration,
  and API rollout; they are unavailable in the local-linkage change.
- TanStack Query owns in-memory REST snapshots, Table owns data-grid behavior,
  Zod owns boundary/search parsing, and React Hook Form owns complex forms.
- Browser storage remains limited to `gantry.ui.preferences.v1`.
- Tailwind v4 utilities style components. `styles.css` contains only tokens,
  font declarations, and global accessibility rules.
- Every handwritten UI file stays at or below 350 lines. Web changes are made
  and reviewed one file at a time.
- Automated UI tests remain deferred. Typecheck, lint, build, browser QA, and
  cleanup checks are mandatory.

## Route Ownership

| Route group                                                                    | Phase |
| ------------------------------------------------------------------------------ | ----- |
| `/ui`, `/profile`                                                              | 1     |
| `/overview`, `/interactions`, `/providers`, `/conversations/*`, `/diagnostics` | 2     |
| `/agents/*`, `/sources`                                                        | 3     |
| `/chat/*`, `/memory`                                                           | 4     |
| `/jobs/*`, `/activity`, `/runtime/*`                                           | 5     |
| `/people/*`                                                                    | 6     |
| `/workflows/*`                                                                 | 7     |

List/detail screens use side-by-side inspectors on desktop, drawers on tablet,
and routed detail on mobile. Manual acceptance covers 1440px, 1024px, and
390px in both themes.
