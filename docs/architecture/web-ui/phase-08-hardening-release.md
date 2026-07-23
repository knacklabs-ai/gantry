# Phase 8: Hardening And Completion

## Goal

Prove the static shell and guarded local-owner linkage are responsive,
accessible, stable, redacted, AWS-dormant, and ready for review without
claiming remote identity or Workflow readiness.

## Work

1. Review every route at 1440px, 1024px, and 390px in light and dark themes.
2. Verify keyboard order, visible focus, overlay focus return, escape behavior,
   reduced motion, touch targets, long words, empty values, and overflow.
3. Exercise loading, empty, error, offline, reconnecting, and disabled states.
4. Verify disabled runtime config starts no `/ui-api` request, polling loop, or
   event stream.
5. Verify connected Models, Jobs/Runs, Memory, Conversations, and Chat against a
   loopback workstation runtime.
6. Force a chat stream interruption and confirm cursor reconnect followed by
   durable message reconciliation.
7. Confirm browser storage contains only `gantry.ui.preferences.v1`; no bearer
   token, provider secret, credential value, Query data, or SSE cursor is
   persisted or emitted in assets, URLs, logs, or errors.
8. Confirm checked-in AWS/fleet deployment files contain neither local-owner
   environment variable and production/non-loopback startup fails closed.
9. Inspect production chunks and remove accidental eager imports, duplicate
   components, unreachable fixtures, and unsupported workflow/chat controls.
10. Update the tracker with commands, browser evidence, commits, known external
    core gate debt, and deferred automated-UI-test debt.

## Completion Checks

```bash
npm run typecheck:web
npm run lint:web
npm run build:web
npm run typecheck
npm run test:unit
npm run test:integration
npm test
npm run build
python3 .codex/scripts/check_architecture.py
python3 .codex/scripts/check_task_completion.py
git diff --check
find apps/web/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 | xargs -0 wc -l
rg -n 'GANTRY_UI_LOCAL_OWNER_(ENABLED|KEY_ID)' ops
rg -n -e 'localStorage' -e 'sessionStorage' -e 'Bearer ' -e 'GANTRY_CONTROL_API' apps/web/src
rg -n -e 'WebSocket' -e 'EventSource' apps/web/src
```

Expected interpretation:

- The `ops` local-owner search returns no matches.
- Browser storage matches only the versioned UI preference implementation.
- Browser code contains the allowlisted fetch-based transport but no bearer or
  Control-key material.
- No browser WebSocket or `EventSource` exists; session streaming uses the
  guarded fetch transport.
- Every handwritten UI source file is at or below 350 lines.

Automated UI tests remain deferred by user decision. Backend bridge tests,
builds, structural checks, and manual browser evidence are required, but the UI
must not be described as release-gate complete until automated UI coverage is
explicitly restored.

## Surface Impact

| Surface                     | Status               | Reason                                                                    |
| --------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Runtime behavior            | Changed              | Final local-owner routing, assets, and route behavior are verified.       |
| `settings.yaml`             | Unchanged by design  | Local-owner mode remains deployment-owned process configuration.          |
| Postgres/runtime projection | Read-only/observable | Existing projections are exercised; no migration is added.                |
| Control API                 | Read-only/observable | Existing routes and the guarded local adapter are regression checked.     |
| SDK/contracts               | Unchanged by design  | No public browser contract is introduced.                                 |
| CLI and MCP/admin           | Unchanged by design  | No UI setup or agent authority surface is added.                          |
| Channel/provider adapters   | Read-only/observable | Existing discovery/message behavior is exercised only through Control.    |
| Docs                        | Changed              | Record completion and residual risk.                                      |
| Audit/events                | Read-only/observable | Existing audit/event behavior is observed, not widened.                   |
| Tests/verification          | Changed              | Backend tests and broad gates run; automated UI testing remains deferred. |

The phase is complete only when the tracker records current command and browser
evidence and every disabled/deferred boundary remains truthful.
