# Phase 7: Workflow Definitions

## Goal

Keep Workflow Definitions visibly unavailable until a separately reviewed
contracts, persistence, API, and AWS migration rollout is approved.

## Current UI Boundary

- `/ui/workflows` renders one unavailable state.
- New, editor, run, and external-system routes are not registered or bundled.
- No workflow fixtures, Query keys, draft schemas, builder, run controls, or
  browser persistence remain in active source.
- No run, enable/disable, retry, cancel, file, receipt, scheduler, permission,
  notification, or external-wait behavior is implied.

## Separately Reviewed Rollout

1. Add additive `workflow_definitions` and immutable `workflow_versions`
   tables without changing existing runtime tables.
2. Add shared discriminated contracts for agent, approval, external, and
   notification steps. Drafts may be incomplete; publish validates references.
3. Add `workflows:read` and `workflows:write` scopes and definition CRUD,
   publish, archive, and version endpoints.
4. Emit create/update/publish/archive audit records. Existing AWS keys receive
   no workflow scopes automatically.
5. Build a controlled React Hook Form editor only after the server contract is
   approved. Expose Save Draft, Publish Version, immutable version inspection,
   archive, conflict recovery, and unsaved-change protection.
6. Do not add workflow execution, a scheduler, permission engine,
   notification engine, external wait engine, or artifact behavior in this
   definition rollout.
7. Validate migrations against disposable Postgres and stage backend and UI
   enablement separately in AWS.

## Acceptance

- Current production and local bundles contain only the unavailable route.
- Cleanup searches find no old workflow editor/run/external route or fixture.
- The local-owner bridge exposes no workflow endpoint.
- No Postgres migration, public contract, SDK method, scope, or AWS variable is
  introduced by the local UI linkage rollout.

## Surface Impact And Handoff

| Surface                     | Current rollout                                       | Future workflow rollout                                                       |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Runtime behavior            | Changed only to remove mock workflow actions          | Adds definition administration only                                           |
| `settings.yaml`             | Unchanged by design; workflows are not settings-owned | Unchanged unless separately approved                                          |
| Postgres/runtime projection | Unchanged by design; no migration                     | Additive definition/version tables                                            |
| Control API                 | Unchanged by design; no workflow routes               | Adds scoped definition/version routes                                         |
| SDK/contracts               | Unchanged by design                                   | Adds workflow schemas and client methods                                      |
| CLI and MCP/admin           | Unchanged by design                                   | Deferred unless explicitly designed                                           |
| Channel/provider adapters   | Unchanged by design                                   | Reused only for validated references                                          |
| Docs                        | Changed                                               | Updated with deployment and contract design                                   |
| Audit/events                | Unchanged by design                                   | Adds definition mutation audit records                                        |
| Tests/verification          | Cleanup/build checks                                  | Migration, isolation, conflict, publish, archive, and immutable-version tests |

Phase 8 may verify the unavailable state but cannot restore mock workflow
functionality as a substitute for the reviewed rollout.
