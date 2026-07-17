# Gantry Web UI Implementation Tracker

Branch: `feature/gantry-web-ui-initiate`
Current rollout: AWS-safe local UI linkage

| Packet | Deliverable                                   | Status      | Evidence                                                      | Commit     |
| ------ | --------------------------------------------- | ----------- | ------------------------------------------------------------- | ---------- |
| P1     | Guarded runtime config and local-owner bridge | Complete    | Focused Control tests, production/remote fail-closed checks   | `932add14` |
| P2     | Browser transport and Query foundation        | Complete    | Zod discovery, REST/SSE transport, no persisted server cache  | `bcaaf3ff` |
| P3     | Models, defaults, credentials, and usage      | Complete    | Live API composition, secret-field reset, web typecheck       | `ad8c5813` |
| P4     | Jobs and run activity                         | Complete    | Live CRUD/actions, active-run polling, safe event projection  | `b07be133` |
| P5     | Memory engine, list, search, and dreaming     | Complete    | Live status/counts/search/actions, unsupported values removed | `f7dcade7` |
| P6     | Conversations and administration              | Complete    | Discovery, messages, approvers, installs, canonical statuses  | `ab9a0614` |
| P7     | Session chat and fetch-based SSE              | Complete    | Ensure/send/reconnect/refetch flow, preview data removed      | `57747fa2` |
| P8     | Workflow rollout boundary                     | Complete    | Mock editor/run routes removed; definitions unavailable       | `f22b4589` |
| P9     | Local setup docs and AWS deployment guardrail | In progress | `.env.example`, README, deployment absence test               | Pending    |
| P10    | Full verification and browser acceptance      | Pending     | Build/test/security/route/responsive evidence                 | Pending    |

## Connected Surfaces

- Models reads catalog/defaults/readiness/usage and mutates defaults and model
  credential readiness through existing Control services.
- Jobs reads jobs/runs/events and supports create, update, delete, pause,
  resume, and trigger. Polling runs only for a selected active run.
- Memory composes brain status, memory records/search, and dreaming status and
  trigger actions.
- Conversations composes provider accounts, canonical conversations, agents,
  installations, messages, threads, and approvers. Discovery remains an
  explicit provider-account action.
- Chat ensures a session for a selected conversation, sends as `Local owner`,
  consumes session SSE with an in-memory cursor, and reconciles to durable
  messages after output, reconnect, terminal, or unknown events.

## Locked Boundaries

- `GANTRY_UI_LOCAL_OWNER_ENABLED` defaults to false and is forbidden in
  checked-in AWS/fleet deployment definitions.
- The bridge requires development/local posture, loopback Control binding,
  process role `all`, full Control routes, same-origin loopback requests, and a
  dedicated scoped key that remains server-side.
- Direct `/v1/*` bearer authentication is unchanged.
- Disabled mode performs runtime discovery only and starts no feature request,
  polling loop, or event stream.
- Browser storage remains limited to `gantry.ui.preferences.v1`; Query and SSE
  state remain memory-only.
- Browser WebSockets, remote identity/auth, hosted-domain transport, People
  identity wiring, Workflow persistence/API/execution, and artifact download
  remain deferred.
- Automated UI tests remain deferred by user decision. Backend bridge tests,
  builds, structural checks, and manual browser acceptance are still required.

## Browser Acceptance

| Check                                         | Status  |
| --------------------------------------------- | ------- |
| Disabled mode makes no `/ui-api` request      | Pending |
| Connected Models, Jobs, Memory, Conversations | Pending |
| Session send and SSE reconnect                | Pending |
| 1440px, 1024px, and 390px in both themes      | Pending |
| Keyboard/focus/overflow/reduced motion        | Pending |
| Direct refresh and unknown `/ui/*` fallback   | Pending |

## Known External Gate Debt

Root lint and architecture checks retain pre-existing core findings outside
the Web UI scope. Record their exact output during final verification; do not
weaken those gates or change unrelated core files to hide them.
