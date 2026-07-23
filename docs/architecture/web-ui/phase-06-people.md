# Phase 6: People

## Goal

Build canonical person, provider-alias, invitation, and merge-preview screens
without treating preview people as browser accounts or durable identities.

## Screens

| Screen        | Major sections and local actions                                               |
| ------------- | ------------------------------------------------------------------------------ |
| People list   | Search, alias/provider filters, conversations, invitation status, open detail. |
| Person detail | Canonical profile, alias provenance, conversations, activity, invitation.      |
| Invite        | Provider target, role summary, local validation, connection-gated send.        |
| Merge preview | Source/target, affected aliases and conversations, conflicts, confirmation.    |

## Implementation

1. Add person/alias/invitation view models, fixtures, Query keys, Table state,
   route search schemas, and local invitation/merge schemas.
2. Compose `/people` and `/people/:id` with shared list/detail, form, dialog,
   timeline, badge, and state components.
3. Preserve provider alias provenance in display data and never infer identity
   from email, display name, or provider ID.
4. Generate merge preview locally from fixtures for inspection only. Invite
   and merge confirmation use the shared connection gate and change nothing.

## Acceptance

- Alias provenance is visible and canonical person IDs are not conflated with
  provider identifiers.
- Merge conflicts remain explicit; confirmation never produces a fake receipt.
- Person detail, invitation, and merge preview remain usable at 390px.
- No auth account, SSO, identity provider, or persisted people store is added.

Run web typecheck, lint, build, route/browser checks, identity-term and storage
cleanup searches, line-count checks, and `git diff --check`.

## Surface Impact And Handoff

| Surface                                         | Status              | Reason                                       |
| ----------------------------------------------- | ------------------- | -------------------------------------------- |
| Runtime behavior                                | Changed             | Preview People routes and dialogs are added. |
| Settings, Postgres, Control API, contracts, CLI | Unchanged by design | People remain preview-only.                  |
| MCP/admin, providers, audit/events              | Unchanged by design | Alias authority is not changed.              |
| Docs                                            | Changed             | Record screens and QA evidence.              |
| Tests/verification                              | Deferred            | Automated UI tests remain deferred.          |

Phase 7 may reference people in workflow notification previews but cannot
create identity or invitation authority.
