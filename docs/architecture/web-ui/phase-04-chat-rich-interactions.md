# Phase 4: Chat And Rich Interactions

## Goal

Connect durable local-owner chat and remembered information without inventing a
session directory, artifact API, interaction resolver, or browser agent loop.

## Current Screen Boundary

| Screen            | Current behavior                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- |
| Chat entry points | Live conversation list; selecting one ensures a durable session.                       |
| Chat thread       | Live session details, durable messages, provider-session state, and runs.              |
| Composer          | Text-only send as `ui-local-owner` / `Local owner`.                                    |
| Stream            | Fetch-based session SSE with in-memory cursor, bounded reconnect, and durable refetch. |
| What I remember   | Live memory list/search with confidence, scope, and provenance.                        |
| Rich interactions | Renderer coverage remains in the development component lab only.                       |

## Implemented Flow

1. Load canonical conversations because the server has no global session-list
   endpoint.
2. Call `/sessions/ensure` for the selected conversation and navigate with the
   returned session ID.
3. Load session details, recent durable messages, and session runs through one
   domain-owned Query key.
4. Send text with `responseMode: sse`, the session thread ID, and the local
   owner sender identity.
5. Start the stream after the accepted event cursor. Keep the cursor and stream
   buffer in memory only.
6. Batch visible streaming text every 80 ms. Only
   `session.message.streaming` and `session.message.outbound` may supply text;
   reasoning/thinking-shaped payloads are ignored.
7. Refetch durable session data after outbound, terminal, unknown, and
   reconnect events. Stop after four failed stream attempts.

## Explicitly Unsupported

- Global session listing, attachments/uploads, stop/cancel, artifact download,
  generic files, and browser-side receipts.
- Question/approval resolution until a canonical interaction list/resolve
  contract is approved.
- Browser WebSockets and provider/channel socket handling.
- Persisted Query data, stream cursors, messages, or drafts outside component
  lifetime.

## Acceptance

- Disabled mode creates no chat query or SSE connection.
- Opening a conversation uses the returned durable session ID.
- Failed sends preserve the draft; accepted sends clear it.
- Reconnect uses `afterEventId` and reconciles with durable messages.
- Reasoning payloads are never rendered or persisted by browser code.
- Message lists remain usable at 390px without horizontal overflow.

Run web typecheck, lint, build, direct-refresh and responsive browser checks,
stream cleanup searches, line-count checks, and `git diff --check`.

## Surface Impact And Handoff

| Surface                     | Status               | Reason                                                                                        |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| Runtime behavior            | Changed              | Active local chat routes may ensure sessions, submit turns, and open one SSE stream.          |
| `settings.yaml`             | Unchanged by design  | Chat does not mutate desired-state configuration.                                             |
| Postgres/runtime projection | Read-only/observable | Existing session/message/run repositories remain durable authority.                           |
| Control API                 | Read-only/observable | Existing session and memory routes are reused through the bridge.                             |
| SDK/contracts               | Unchanged by design  | Browser schemas are private and no public protocol is added.                                  |
| CLI and MCP/admin           | Unchanged by design  | No new adapter surface is added.                                                              |
| Channel/provider adapters   | Read-only/observable | Slack and other sockets remain server-side adapter concerns.                                  |
| Docs                        | Changed              | Record stream and unsupported-action boundaries.                                              |
| Audit/events                | Read-only/observable | Existing session runtime events drive observation.                                            |
| Tests/verification          | Changed              | Server stream/bridge tests and manual UI checks are required; UI automation remains deferred. |

Phase 5 reuses Query and shared state compositions without coupling runtime
screens to the ephemeral chat stream buffer.
