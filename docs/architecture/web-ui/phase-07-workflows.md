# Phase 7: Workflows

## Goal

Build workflow UI on existing capability, permission, run, interaction, and
notification authority. Workflow input cannot grant tools, create a scheduler,
or replace durable terminal evidence.

## Dependencies And Exclusions

Dependencies: agents, capabilities, jobs/runs, interactions, activity,
notification services, and the existing Query/Table/form foundations. Excluded:
workflow-created permissions, a new scheduler engine, or provider-specific
workflow execution logic.

## Screens

| Screen        | Major sections and actions                                                         |
| ------------- | ---------------------------------------------------------------------------------- |
| Workflow list | Definitions, latest immutable version, enabled state, owner, create/open.          |
| Definition    | Draft, validation, capability requirements, version history, enable/disable.       |
| Run detail    | External-step state, blocker/interaction, timeline, notifications, receipt, audit. |
| Limit state   | Honest unavailable/blocked/error message and one safe next action.                 |

## Steps

1. Add workflow application, storage, contracts, and API only where job/run
   primitives do not express workflow semantics.
2. Validate a draft before immutable version creation. Enable a valid version;
   never mutate historical versions.
3. Reuse reviewed capabilities, interactions, run leasing, notification routes,
   and events; use shared timeline and rich renderer.
4. Persist audit/event evidence for validation, enablement, run states, blocks,
   recovery, and terminal outcomes.

Reuse React Hook Form for draft editing, Query for definition/version/run
snapshots and mutations, and shared tables/timelines for history. Do not add
TanStack Form or a workflow-local state store.

## Acceptance And Checks

- Valid drafts create immutable versions; enabled versions run.
- Missing capability requirements show one clear action and never auto-grant.
- Terminal runs leave durable run, event, audit, and notification evidence.

```bash
rg -n -e 'WorkflowPermission' -e 'WorkflowScheduler' -e 'grantCapability' -e 'enableTool' -e 'pg-boss' apps/core/src apps/web/src
```

Automated UI tests remain deferred. Verify the acceptance paths manually and
run the repository build and structural gates for the implementation change.

## Surface Impact And Handoff

| Surface                                                      | Status               | Reason                                                        |
| ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------- |
| Runtime, Postgres, API, contracts, audit/events, docs        | Changed              | Add workflow lifecycle through existing authority services.   |
| Tests                                                        | Deferred             | No automated UI harness exists until separately approved.     |
| Settings                                                     | Read-only/observable | Workflow configuration is not agent desired state by default. |
| CLI, MCP/admin, providers                                    | Unchanged by design  | No duplicate administration or transport implementation.      |

Phase 8 hardens draft, blocked, running, recovered, failed, and completed
workflow states.
