# Phase 4: Chat And Rich Interactions

## Goal

Build the complete chat, session, and remembered-information experience from
preview conversations without simulating agent execution.

## Screens

| Screen            | Major sections and local actions                                                         |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Session list      | Search, agent/status filters, recent activity, open/create action.                       |
| Chat thread       | Messages, run timeline, files, receipts, connection state.                               |
| Composer          | Text and attachment drafting, retained input, connection-gated send/stop.                |
| Rich interactions | Questions, approvals, todos, progress, facts, lists, tables, forms, media, dependencies. |
| What I remember   | Memory categories, confidence/provenance, contradictions, review action.                 |

## Implementation

1. Add chat/message/run/memory view models, fixtures, Query keys, and session
   route search schemas.
2. Build Gantry-owned rich renderers from shared primitives. Do not add
   `assistant-ui` or define a second server descriptor protocol.
3. Compose `/chat`, `/chat/:sessionId`, and `/memory`; keep session navigation
   usable as a drawer on small screens.
4. Keep composer and local interaction choices in memory. Send, stop, approve,
   answer, upload, and memory-review commands use the connection gate and do
   not append messages or terminal receipts.

## Acceptance

- Every renderer has populated, missing-content, disabled, and long-content
  coverage in the component lab and a real route composition.
- Composer content survives opening and closing the connection gate.
- Message lists remain readable at 390px without horizontal overflow.
- No reasoning-text filters, browser stream buffers, network transport, or
  provider payloads are introduced.

Run web typecheck, lint, build, direct-refresh and responsive browser checks,
renderer cleanup searches, line-count checks, and `git diff --check`.

## Surface Impact And Handoff

| Surface                                         | Status              | Reason                                                    |
| ----------------------------------------------- | ------------------- | --------------------------------------------------------- |
| Runtime behavior                                | Changed             | Preview chat, memory, and rich-renderer routes are added. |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | No turn or interaction is submitted.                      |
| MCP/admin, providers, audit/events              | Unchanged by design | Provider and authority behavior remains server-side.      |
| Docs                                            | Changed             | Record renderer coverage and evidence.                    |
| Tests/verification                              | Deferred            | Automated UI tests remain deferred.                       |

Phase 5 reuses timelines, status, tables, and receipts without coupling runtime
screens to chat presentation state.
