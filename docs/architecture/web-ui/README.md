# Gantry Web UI Delivery

These documents define the frontend-first delivery of the Gantry operator UI.
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

- Build every planned screen now with visibly labeled preview data.
- Local navigation, filtering, sorting, pagination, drawers, tabs, validation,
  inspectors, and drafts are functional.
- Server-owned commands open the shared `Connect Gantry to continue` gate and
  never simulate success or mutate preview records.
- Browser auth, REST, SSE, WebSockets, credentials, Control API changes,
  persistence, and audit events remain deferred.
- Business data is memory-only. Browser storage remains limited to
  `gantry.ui.preferences.v1`.
- TanStack Query owns preview read state, Table owns data-grid behavior, Zod
  owns route search parsing, and React Hook Form owns complex local drafts.
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
