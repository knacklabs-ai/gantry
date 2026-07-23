# Phase 1: Foundation And Hosting

## Goal

Create `apps/web`, host it at `/ui`, and establish the static operator shell.
This phase is complete at commit `62df6a5a`; later phases extend the shell with
preview-backed screens without adding browser transport.

## Dependencies And Exclusions

Dependencies: static asset packaging and the existing Control server. Excluded:
product screens, browser access authority, OAuth/OIDC, SAML, REST, SSE,
WebSockets, runtime data, and automated UI tests.

## Screens

| Screen        | Required behavior                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------- |
| App shell     | Sidebar, mobile drawer, header, theme control, truthful not-connected state, stable content area. |
| Shared states | Loading, empty, error, offline, and reconnecting compositions without simulated data.             |
| Profile       | Theme and motion preferences only; no identity or session fields.                                 |

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
   `gantry ui` CLI work, app events, and SSE. Later UI phases use preview data
   and a shared connection gate instead.

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

| Surface                                                              | Status              | Reason                                                                |
| -------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Runtime behavior                                                     | Changed             | Serve static `/ui` assets through the existing Control process.       |
| `settings.yaml`, Postgres, Control API, contracts, CLI, audit/events | Unchanged by design | Static UI introduces no browser authority or persisted runtime state. |
| MCP/admin, providers                                                 | Unchanged by design | UI does not grant authority; adapters retain transport.               |
| Docs                                                                 | Changed             | Record the static-only boundary and delivery evidence.                |
| Tests/verification                                                   | Deferred            | Automated UI tests remain explicitly deferred.                        |

Phase 2 receives a verified shell, static host, tokens, primitives, and shared
states. It may add frontend data libraries for preview screens, but it must not
add browser-to-server transport.
