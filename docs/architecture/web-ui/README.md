# Gantry Web UI Delivery Phases

These documents expand the parent [Gantry Web UI Implementation Plan](../gantry-web-ui-implementation-plan.md)
into independently deliverable handoffs. The parent plan owns shared
architecture and decisions; phase documents may add delivery detail but must
not contradict it.

## Order

1. [Foundation and hosting](./phase-01-foundation-hosting.md)
   - [Implementation plan](./phase-01-foundation-hosting-implementation-plan.md)
   - [Implementation tracker](./phase-01-foundation-hosting-tracker.md)
2. [Operations console](./phase-02-operations-console.md)
3. [Agent administration](./phase-03-agent-administration.md)
4. [Chat and rich interactions](./phase-04-chat-rich-interactions.md)
5. [Jobs, runtime, and activity](./phase-05-jobs-runtime-activity.md)
6. [People](./phase-06-people.md)
7. [Workflows](./phase-07-workflows.md)
8. [Hardening and release](./phase-08-hardening-release.md)

## Shared Rules

- `apps/web` is a React application built separately and served by the existing
  Gantry process at `/ui`. Phase 1 development runs Vite on `5173` without an
  API proxy because the shell has no browser-to-server transport.
- Phase 1 uses a code-defined TanStack Router tree. File-based generation,
  router plugins, and generated route trees are excluded so every handwritten
  UI file remains within the 350-line limit.
- REST and HTTP SSE remain the future browser transport design. They are not
  introduced until browser identity and access authority are separately approved.
- Query, Table, and Zod begin only with Phase 2 browser data work; React Hook
  Form begins with Phase 3 administration forms. Query remains the in-memory
  REST snapshot cache, while SSE remains a separate observation coordinator.
- React consumes canonical contracts only. Provider Socket Mode/webhooks remain
  server-side channel adapter concerns.
- Phase 1 has no browser authentication, pairing, REST, SSE, or WebSocket path.
  Identity, OAuth/OIDC, SAML, SSO, roles, browser access authority, and
  non-loopback browser data access are deferred.
- Desired-state writes use `SettingsDesiredStateService`, revision concurrency,
  projection reconciliation, and `settings.yaml` synchronization.
- Automated UI testing is deferred. The test commands listed in individual
  phase documents are future scope only and must not be added, run, or reported
  as evidence until the user explicitly approves test work. Current phase
  evidence is manual acceptance, cleanup searches, builds, and structural gates.

## Route Ownership

| Route group                                                      | Phase |
| ---------------------------------------------------------------- | ----- |
| `/ui`, `/profile`                                                | 1     |
| `/overview`, `/providers`, `/conversations/:id?`, `/diagnostics` | 2     |
| `/agents/:id?`                                                   | 3     |
| `/chat/:sessionId`                                               | 4     |
| `/jobs/:id?`, `/activity`, `/runtime/*`                          | 5     |
| `/people/:id?`                                                   | 6     |
| `/workflows/:id?`                                                | 7     |

Every route includes loading, empty, partial-data, error, stale, reconnecting,
and offline states. Below 900px inspectors become drawers or routed detail;
below 640px navigation becomes a drawer and tables expose compact detail.
