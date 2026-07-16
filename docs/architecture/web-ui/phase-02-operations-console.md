# Phase 2: Operations Console

## Goal

Deliver an operator view of canonical runtime state. Reuse provider,
conversation, health, doctor, usage, job, and run services. Add only
session-list, interaction-list/resolve, and event projections missing from the
current API. Provider-native payloads never reach React.

## Dependencies And Exclusions

Dependencies: approved browser-access design, Phase 1 shell, TanStack Query,
TanStack Table, Zod route-search schemas, browser client, SSE coordinator, and
shared inspectors. Excluded: agent editing, WebUI chat, workflow authoring, and
provider transport changes.

## Screens

| Screen        | Major sections and actions                                                    |
| ------------- | ----------------------------------------------------------------------------- |
| Overview      | Health, usage, active work, waiting interactions, recent activity, drill-in.  |
| Providers     | Accounts, readiness, discovery, redacted secret readiness, open Conversation. |
| Conversations | List/filter, message/thread inspector, policy, approvers, agent installs.     |
| Interactions  | Context and server-offered `Allow once`, durable choice, or `Cancel`.         |
| Diagnostics   | Health, doctor findings, guided remediation, provider readiness.              |

List/detail screens use shared tables and inspectors; mobile uses drawers or
routed detail. Every screen implements shared loading through offline states.

## Steps

1. Introduce domain-owned Query key factories, an in-memory Query client,
   controlled Table state, and resilient Zod search schemas before composing
   overview, inspector, timeline, and event invalidation routes.
2. Add browser-safe interaction list/resolve and session-list routes through
   application services; resolution is the same durable path as channels.
3. Project canonical conversation/interaction updates into SSE. Provider socket
   events only wake server work.
4. Submit secrets only to dedicated write-only server forms; render redacted
   readiness and remediation.

Query owns REST snapshots and mutation convergence. SSE only invalidates or
updates known records; provider payloads and SSE events never become a second
browser state store.

## Acceptance And Checks

- An operator discovers a Conversation, inspects policy/messages, resolves a
  pending interaction, and sees all affected views converge via events.
- Diagnostics are server-derived; secrets and raw provider payloads never enter
  rendered components or query cache.

```bash
rg -n -e 'slack_event' -e 'slackPayload' -e 'SocketMode' -e 'xapp-' -e 'providerPayload' -e 'statusColor' apps/web/src
```

Automated UI tests remain deferred. Verify the acceptance paths manually and
run the repository build and structural gates for the implementation change.

## Surface Impact And Handoff

| Surface                                            | Status               | Reason                                                            |
| -------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| Runtime, API, contracts, audit/events, docs        | Changed              | Add safe projections, routes, event types, and operator guidance. |
| Tests                                              | Deferred             | No automated UI harness exists until separately approved.         |
| Postgres                                           | Read-only/observable | Reuse durable interactions and runtime events.                    |
| Settings, CLI, MCP/admin, providers                | Unchanged by design  | No config, authority, or transport change.                        |

Phase 3 reuses interaction and Conversation compositions without forking them.
