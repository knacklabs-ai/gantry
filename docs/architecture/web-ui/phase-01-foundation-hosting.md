# Phase 1: Foundation And Hosting

## Goal

Create `apps/web` and host it at `/ui`. This is a static operator-shell phase:
it has no browser authentication, pairing, REST, SSE, WebSocket, or runtime
data access. It ships shared UI states, not operational data screens.

## Dependencies And Exclusions

Dependencies: static asset packaging and the existing Control server. Excluded:
operator screens, browser access authority, identity accounts, OAuth/OIDC,
SAML, browser REST/SSE/WebSockets, and runtime data.

## Screens

| Screen        | Required behavior                                                                     |
| ------------- | ------------------------------------------------------------------------------------- |
| App shell     | Sidebar, mobile drawer, header, theme control, truthful not-connected state, stable content area. |
| Shared states | Loading, empty, error, offline, and reconnecting compositions without simulated data.          |
| Profile       | Theme and motion preferences only; no identity or session fields.                               |

## Steps

1. Add Vite/React workspace, a code-defined TanStack Router tree, tokens,
   primitives, shared compositions, and untracked `dist` output. Do not add a
   router plugin/generated route tree, server-data libraries, a frontend test
   harness, or testing dependencies in this phase.
2. Build and serve the SPA under `/ui` with UI-only history fallback. Vite runs
   on `5173` without a Control API proxy.
3. Add the static app shell, profile preferences, and shared state compositions.
   Browser storage is limited to versioned appearance and motion preferences.
4. Defer contracts, browser API clients, pairing, sessions, CSRF, audit,
   `gantry ui` CLI work, app events, and SSE until a separate browser-access
   design is approved.

## Acceptance And Checks

- Direct `/ui` and `/ui/profile` refresh work; `/v1`, SSE, WebSocket, bearer,
  credential, Query, Table, Zod, form, and generated-router paths remain absent
  from the browser bundle.
- Shell works at 1440px, 1024px, and 390px in both themes.

```bash
npm run build:web
npm run typecheck
npm run lint
npm run build
rg -n -e 'localStorage' -e 'sessionStorage' -e 'fetch\\(' -e 'EventSource' -e 'WebSocket' -e 'Bearer ' -e 'GANTRY_CONTROL_API' apps/web apps/core/src packages --glob '!**/dist/**'
```

Only the versioned preference record is acceptable in cleanup results; browser
credentials, API clients, transport calls, and tracked UI output are not.

## Surface Impact And Handoff

| Surface | Status | Reason |
| --- | --- | --- |
| Runtime behavior | Changed | Serve static `/ui` assets through the existing Control process. |
| `settings.yaml`, Postgres, Control API, contracts, CLI, audit/events | Unchanged by design | Static UI introduces no browser authority or persisted runtime state. |
| MCP/admin, providers | Unchanged by design | UI does not grant authority; adapters retain transport. |
| Docs | Changed | Record the static-only boundary and delivery evidence. |
| Tests/verification | Deferred | Automated UI tests remain explicitly deferred. |

Browser data phases start only after a dedicated browser-access design is
approved. This phase hands off a stable shell, static host, tokens, primitives,
and shared compositions.
