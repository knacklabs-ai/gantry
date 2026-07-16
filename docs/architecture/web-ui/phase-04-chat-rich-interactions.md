# Phase 4: Chat And Rich Interactions

## Goal

Deliver WebUI chat through canonical sessions and `InteractionDescriptor`.
REST submits commands; SSE observes durable runs. The browser neither filters
reasoning by text heuristics nor defines a parallel rich-message schema.

## Dependencies And Exclusions

Dependencies: approved browser-access design, Phase 2 Query/SSE foundations,
and Phase 2 interaction APIs. Excluded: provider WebSockets, browser-held
provider credentials, text-based reasoning filters, and a separate rich
descriptor protocol.

## Screens

| Screen        | Major sections and actions                                                              |
| ------------- | --------------------------------------------------------------------------------------- |
| Session list  | Agent/conversation/status filters, title, recent activity, create/open.                 |
| Chat thread   | Messages, stream, connection state, run timeline, final evidence, files.                |
| Composer      | Text, supported attachment, send, stop/cancel.                                          |
| Rich renderer | Questions, approvals, todos, facts, lists, tables, forms, media, dependencies, results. |

## Steps

1. Reuse session ensure/get/messages/events/runs and memory APIs; add only
   session list and interaction resolve gaps named by the parent plan.
2. Present `202 Accepted` as durable admission, never completion.
3. Render all descriptor kinds through shared `ui/rich` components; interaction
   actions use durable server APIs.
4. Throttle paint work without dropping events; refetch after reconnect or an
   unknown event type.

Query owns session, message, and run snapshots. Streaming deltas use a bounded,
throttled local presentation buffer and reconcile into Query only on durable
message/run events; do not invalidate or write Query state for every token.
Build the Gantry rich renderer directly and do not add `assistant-ui`.

## Acceptance And Checks

- A turn is accepted, streamed, interrupted by a question/permission, resolved
  in UI or channel, resumed, and completed after reconnect.
- Reasoning blocks are omitted at provider boundaries, not by UI prefix filters.

```bash
rg -n -e 'startsWith\(' -e 'includes\(.*thinking' -e 'UISpec' -e 'RichInteractionDescriptor.*interface' -e 'providerPayload' apps/web/src
```

Automated UI tests remain deferred. Verify the acceptance paths manually and
run the repository build and structural gates for the implementation change.

## Surface Impact And Handoff

| Surface                                            | Status               | Reason                                                             |
| -------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| Runtime, API, contracts, audit/events, docs        | Changed              | Add session listing, rich rendering, and event handling.           |
| Tests                                              | Deferred             | No automated UI harness exists until separately approved.           |
| Postgres                                           | Read-only/observable | Reuse durable sessions, messages, runs, and interactions.          |
| Settings, CLI, MCP/admin, providers                | Unchanged by design  | No configuration, authority, or transport widening.                |

Phase 5 reuses shared timelines but owns jobs and runtime controls separately.
