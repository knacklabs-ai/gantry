# Phase 3: Agent Administration

## Goal

Manage agent desired state through Gantry services. Browser code never edits
profile files, `settings.yaml`, or Postgres directly; raw provider model IDs
remain invalid at public UI boundaries.

## Dependencies And Exclusions

Dependencies: Phase 2 Query/Table/search foundations, Conversation and
interaction compositions, React Hook Form, and existing desired-state services.
Excluded: direct settings/file/SQL writes, raw model IDs, user identity, and
UI-created permission authority.

## Screens

| Screen            | Major sections and actions                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Agent list        | Status, model alias, harness, assigned Conversations, pause, create/select.                           |
| Agent detail      | Identity, model/harness, profile, sources, capabilities, skills, MCP, access, installs, pause/resume. |
| Revision conflict | Server revision, changed fields, reload, deliberate retry after reconciliation.                       |
| Credentials       | Write-only secret input when supported, redacted readiness, one remediation.                          |

## Steps

1. Build agent routes from existing agent, catalog, profile, source,
   capability, skill, MCP, access, and Conversation-install services.
2. Send desired-state writes with `expectedRevision`; display returned revision
   and invalidate/refetch affected Query records after SSE.
3. Use protected profile services, catalog aliases, and `agentHarness`, never
   raw provider IDs or legacy engine fields.
4. Render reviewed capability/access state rather than creating a UI permission
   store.

Use React Hook Form only for the multi-field agent administration surfaces.
Validation remains contract-aware and server authority remains final; do not add
TanStack Form or a feature-local mutable store.

## Acceptance And Checks

- Valid changes survive restart, reconcile projection, and synchronize
  `settings.yaml`; stale writes conflict rather than overwrite.
- No UI route writes files, SQL, or provider-specific flags.

```bash
rg -n -e 'writeFile' -e 'settings\.yaml' -e 'INSERT INTO' -e 'modelId' -e 'providerModelId' -e 'permissionStore' apps/web/src apps/core/src/control
```

Automated UI tests remain deferred. Verify the acceptance paths manually and
run the repository build and structural gates for the implementation change.

## Surface Impact And Handoff

| Surface                                                                    | Status               | Reason                                                  |
| -------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| Settings, runtime, Postgres projection, API, contracts, audit, docs        | Changed              | Add revision-aware administration and safe projections. |
| Tests                                                                      | Deferred             | No automated UI harness exists until separately approved. |
| CLI                                                                        | Read-only/observable | CLI remains another adapter over the same services.     |
| MCP/admin, providers                                                       | Unchanged by design  | No change to agent-request or transport authority.      |

Phase 4 may use agent/conversation selectors but cannot create a second
session or capability model.
