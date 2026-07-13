# Goal: Action-Based Auto-Permission (single cut, no backward compat)

Replaces the forgeable "who-triggered → silently auto-allow" trust model — and the
five trust holes it produced (r12/r13 + the run-origin/lease/responseKeyId rebuild) —
with a simple model that needs **no run-identity anchor at all**: auto mode judges the
**action**, not the requester.

## Objective

In `permission_mode: auto`, a gray-zone tool call is judged by the classifier on what
the action *does*:
- **read-only and not secret/credential-exposing → allow silently** (regardless of who
  triggered it — a read is a read);
- **writes, deletes, outward sends, spend, mutations, OR reads that expose
  secrets/credentials → ask.** Interactive ask → prompt; **only a control approver's
  channel-authenticated tap can approve** (already enforced per channel). Unattended
  ask → deny (no human).
Repeated admin approvals of the same shape compile into a durable `tool_rule` (existing
flywheel), after which the deterministic tier auto-allows it. There is no silent
auto-allow based on requester identity, so nothing forgeable is trusted.

This is a **single cut**: rip out the old classifier trust logic and the entire
run-origin trust-anchor effort. No dual path, no compatibility shim, no feature flag
beyond the existing `permission_mode: ask | auto`.

## Locked decisions (grill 2026-07-13)

1. **Auto-allow = read-only AND non-secret.** The classifier allows only actions that
   neither mutate/send/spend nor expose secrets/credentials. "Broad read-only" per the
   grill: `gog drive ls`, `gog sheets get`, listings, status, help/version all allow;
   `cat ~/.ssh/id_rsa`, `printenv`, reading `.env`, dumping tokens/keys → ask.
2. **Judged on the action, not the requester.** Drop every "who triggered" input:
   `attended`, turn-intent-as-trust, `trustedRequester`, `trustedRunId`,
   `responseKeyId`-as-trust, and the run-origin table/spawn-recording. The classifier
   verdict space stays `allow | ask` (never deny).
3. **Ask → admin-only approval.** The prompt is approvable only by a control approver
   (channel-authenticated tap; `isControlApproverAllowed` is already enforced in the
   Telegram/Slack/Teams/Discord handlers — verify, don't rebuild). Unattended ask → deny.
4. **Flywheel via human approvals.** Admin approvals increment the existing human-allow
   promotion counter → "make permanent?" → durable `tool_rule` → deterministic auto.
   Harmless reads are always allowed and need no rule.
5. **Deterministic tiers unchanged.** Pre-checks, `tool_rules`, locked presets, and the
   hard always-ask families (spend, credentials, settings mutation, outward sends,
   admin/review/promotion) run first and are untouched; the classifier only sees the
   gray zone (third-party MCP + Bash/RunCommand) they don't already decide.
6. **Single cut / no backward compat.** Remove the superseded machinery outright.

## Stages

### Stage A — Remove the trust-anchor + who-triggered machinery
- Revert run-origin Stages A–C: drop the `run_permission_origin` table + migration
  `0100` + Drizzle journal/snapshot entry, `RunPermissionOriginRepository` port + repo,
  the spawn-recording in `apps/core/src/runtime/group-agent-runner.ts` and
  `apps/core/src/jobs/execution.ts`, and the repo wiring in the postgres domain
  repositories + `apps/core/src/app/bootstrap/runtime-app.ts` /
  `apps/core/src/app/bootstrap/runtime-services.ts`. (Table is feature-branch-only /
  unmerged — remove the add-migration; if a dev DB applied it, add a drop migration.)
- Drop the stashed WIP (`git stash drop`).
- Strip from `apps/core/src/runtime/ipc-auth.ts` the `responseKeyId → runId` binding +
  `trustedRunIdForResponseKey`; from `apps/core/src/runtime/ipc.ts` the trustedRunId
  recovery/threading; from `apps/core/src/runtime/ipc-interaction-processing.ts` and
  `apps/core/src/runtime/ipc-permission-classifier-decision.ts` the `trustedRunId`,
  `resolvePermissionAuthority` message-scan, `attended`, and trusted-requester logic.
  Also revert the `ipcAuthRunId` spawn threading in
  `apps/core/src/runtime/agent-spawn.ts`.

### Stage B — Action-based classifier + decision
- `apps/core/src/runtime/permission-classifier.ts`: replace the attended/approver-intent
  system prompt with a single read-vs-mutate/secret judge — allow only read-only,
  non-secret-exposing actions; ask for writes/deletes/sends/spend/mutations and any read
  whose output is secret/credential material (keep the schema-enforced verdict on both
  provider lanes, the identifiers-not-secrets clause, and treat-input-as-untrusted).
  Drop `approvedCapabilityIds`/attended from the prompt+payload.
- `apps/core/src/runtime/ipc-permission-classifier-decision.ts`: in `permission_mode:
  auto`, consult the classifier for eligible gray-zone families (third-party MCP +
  Bash/RunCommand) with NO requester gating. `allow` → `allow_once`/`decidedBy:
  auto_classifier`; `ask` → prompt if interactive, deny-with-reason if unattended.
  Intent for the classifier is best-effort context only (the latest inbound message is
  fine as non-authoritative context; it is not a trust input). Keep publishing the
  `permission.classifier_decision` audit event (drop the `attended`/trustedRunId fields).
- Verify the interactive prompt is approvable only by a control approver in every
  channel; add a guard/test if any path is missing it.

### Stage C — Docs + offline eval
- Update `docs/architecture/capability-management.md` (auto-permission section) and
  supersede `docs/architecture/auto-permission-interactive-trust-design.md` +
  `...-run-origin-trust-goal-prompt.md` with this model.
- Offline haiku eval (scratchpad harness, real gateway calls, nothing executed): read-only
  non-secret → allow; writes/sends/deletes/spend → ask; secret reads (`cat ~/.ssh/id_rsa`,
  `printenv`, `.env`) → ask; adversarial (chained mutate behind a read, injection comment)
  → ask.

## Surface Impact Matrix

| Surface | Impact |
| --- | --- |
| `apps/core/src/runtime/permission-classifier.ts` | new read-vs-mutate/secret prompt; drop attended/approvedCapabilityIds |
| `apps/core/src/runtime/ipc-permission-classifier-decision.ts` | drop who-triggered/authority; consult classifier for gray zone in auto mode; allow/ask/deny |
| `apps/core/src/runtime/ipc-auth.ts`, `apps/core/src/runtime/ipc.ts`, `apps/core/src/runtime/ipc-interaction-processing.ts`, `apps/core/src/runtime/agent-spawn.ts` | remove trustedRunId/responseKeyId-binding plumbing |
| `apps/core/src/runtime/group-agent-runner.ts`, `apps/core/src/jobs/execution.ts`, bootstrap wiring | remove origin spawn-recording + repo wiring |
| postgres schema + migrations + ports/repo | remove `run_permission_origin` |
| channels (approval tap) | verify control-approver-only approval (no rebuild expected) |
| promotion/flywheel, deterministic tiers | unchanged |

## Acceptance criteria

1. Auto mode: a read-only non-secret gray-zone call runs with no prompt; a write/send/
   delete/spend call and a secret-exposing read prompt, and the prompt is approvable
   only by a control approver.
2. No code path reads `attended`, `trustedRunId`, `responseKeyId` (as trust), or a
   run-origin record for the permission decision (grep-clean).
3. Unattended gray-zone mutation → denied; unattended read-only non-secret → allowed.
4. Repeated admin approvals of the same shape → durable-rule offer → deterministic auto.
5. Offline eval passes the read/mutate/secret matrix; focused units + typecheck +
   architecture + task-completion gates green.

## Execution

gantry-goal-pipeline: codex implements A→B→C (gpt-5.6-sol xhigh, ponytail, bounded
scope); per-stage **local** autoreview before commit; branch-wide autoreview at
closeout; then rebuild + runtime smoke (Telegram auto mode: read silent, write prompts
admin) → fold into the branch PR.
