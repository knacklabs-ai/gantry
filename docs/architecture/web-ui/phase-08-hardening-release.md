# Phase 8: Hardening And Completion

## Goal

Prove that every planned preview screen is responsive, accessible, stable,
optimized, consistently composed, and ready for later server integration.

## Work

1. Review every route at 1440px, 1024px, and 390px in light and dark themes.
2. Verify keyboard order, visible focus, overlay focus return, escape behavior,
   reduced motion, touch target size, long words, empty values, and overflow.
3. Exercise populated, loading, empty, partial, error, offline, reconnecting,
   and not-connected states through the component lab and real routes.
4. Inspect production chunks and remove accidental eager imports, duplicate
   components, unnecessary dependencies, and unreferenced fixtures.
5. Confirm server-owned commands share one connection gate, issue no network
   requests, preserve drafts, and never mutate preview records.
6. Confirm browser storage contains only `gantry.ui.preferences.v1` and no API,
   auth, SSE, WebSocket, credential, or provider-payload code exists.
7. Update the tracker with screenshots/check output, commits, known external
   core gate debt, and deferred automated-test debt.

## Completion Checks

```bash
npm run typecheck:web
npm run lint:web
npm run build:web
npm run typecheck
npm run build
git diff --check
find apps/web/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 | xargs -0 wc -l
rg -n -e 'fetch\(' -e 'EventSource' -e 'WebSocket' -e 'Bearer ' -e 'sessionStorage' -e 'GANTRY_CONTROL_API' apps/web/src
```

Automated UI tests remain deferred and the completed preview UI must not be
described as a live or release-complete server integration.

## Surface Impact

| Surface                                         | Status              | Reason                                                                   |
| ----------------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| Runtime behavior                                | Changed             | Final frontend assets and route behavior are hardened.                   |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | No backend integration is introduced.                                    |
| MCP/admin, providers, audit/events              | Unchanged by design | Authority and transport remain server-side.                              |
| Docs                                            | Changed             | Record completion and residual risk.                                     |
| Tests/verification                              | Deferred            | Automated UI tests remain deferred; manual browser evidence is required. |

The phase is complete only when the tracker proves every screen, viewport,
theme, local interaction, and deferred boundary from current source and browser
evidence.
