# Boondi Domain Skills Migration Plan

Status: Implemented end to end. Phase 7 passed after fixing the live
warm-worker fallback defect found by the 5-core scaling gate.

Updated: 2026-06-20.

Template alignment: reviewed against
`agents/boondi_support/docs/plan-guiding-template.md`.

Testing level decision: minimal focused live proof first, then an ultimate full
live Template_BA and scaling phase after all earlier phases pass. The user
approved the final all-scenario phase; it was attempted after Phases 0-6 passed
and is now blocked by runtime delivery stability.

Commit policy: do not commit or stage any change made during this plan unless
the user explicitly asks.

## Goal

- In scope: replace the selected monolithic runtime skill `boondi-kb` with
  multiple Boondi-owned, progressive, domain-specific SDK skills; make surgical
  code, MCP, skill, KB, prompt, and eval-harness changes when evidence proves
  they are needed.
- Out of scope: rewriting Gantry skill materialization architecture,
  broadening MCP behavior without an evidence-backed defect, changing Boondi
  tone policy without Template_BA/domain-doc support, or running the ultimate
  full live phase before the earlier gates pass.
- Success means: live payloads expose the domain skills, the always-on prompt
  stays free of full skill bodies, relevant live replies remain correct,
  `boondi-kb` is no longer selected, and the final all-59-scenario live/load
  phase passes.
- Non-goals: exact LLM wording matches, hard-coding Boondi skill names into
  Gantry core, or maintaining two runtime sources of truth.

## Current Evidence

Code evidence:

- Agent-folder SDK skills must live as folders with `SKILL.md`:
  `agents/boondi_support/skills/<skill-id>/SKILL.md`.
- Flat files like `agents/boondi_support/skills/boondi-gifting.md` are ignored.
- Folder presence alone does nothing. The skill id must be declared under
  `agents.<folder>.plugins.skills`.
- `plugins.skills` already accepts multiple folder ids.
- `SKILL.md` frontmatter `name:` must match the folder id after sanitization, or
  materialization fails.
- The materializer copies only valid skill folders into the per-run Claude SDK
  `skills/` directory.
- The runner passes materialized names through SDK `options.skills`.
- When SDK skills are enabled and native tool surface is restricted, Gantry adds
  the provider-native `Skill` tool.
- Progressive agent-folder skill pointers are generated without inlining the
  skill body into `systemPrompt.append`.

Existing runtime/live evidence:

Live payloads currently expose:

```json
"skills": ["boondi-kb", "gantry-admin"]
```

The individual files under `agents/boondi_support/kb/` are not independently
loaded as skills. They are source Markdown files only. The runtime skill is
`agents/boondi_support/skills/boondi-kb/SKILL.md`, which repeats domain details
because it is the only Boondi business skill selected today.

This is not the robust long-term architecture.

Primary code paths:

- `apps/core/src/adapters/llm/anthropic-claude-agent/claude-skill-materializer.ts`
- `apps/core/src/adapters/llm/anthropic-claude-agent/claude-config-materializer.ts`
- `apps/core/src/adapters/llm/anthropic-claude-agent/execution-adapter.ts`
- `apps/core/src/adapters/llm/anthropic-claude-agent/native-sdk-skills.ts`
- `apps/core/src/adapters/llm/anthropic-claude-agent/runner/query-loop.ts`
- `apps/core/src/config/settings/runtime-settings-agents-parser.ts`
- `apps/core/src/config/settings/runtime-settings-renderer.ts`
- `apps/core/src/runtime/session-resume-runtime.ts`

Existing payload/log/trace evidence:

- `llm-sdk-query-args.json` has shown `skills:["boondi-kb","gantry-admin"]`.
- Previous focused live checks showed `boondi-kb` can be progressively listed,
  but did not prove individual domain skill selection because those skills do
  not yet exist as selected runtime skills.

Existing transcript/output evidence:

- Functional Template_BA evidence existed before this migration plan, but this
  plan must not claim the split is safe until focused live proof and
  cross-regression pass after the split.

Assumptions not yet proven:

- Each domain skill body can be split without losing regression-critical
  guidance.
- The runtime desired-state update will project all selected domain skills into
  `options.skills` in the live webhook path.
- The provider-native `Skill` tool will open the expected domain skill in
  representative live turns.

Open questions:

- The exact multi-core launch command and evidence collection flow for 5 cores
  x 12 warm workers must be verified from current code before the final phase
  runs.
- The current `run-template-ba-live.ts` sends selected scenarios sequentially.
  The final phase must either enhance it for safe parallel execution or use a
  proven existing orchestrator that can distribute all 59 scenarios across the
  5-core runtime.

## Source Of Truth

- Code is the source of truth for skill discovery, materialization, runtime
  selection, and SDK payload shape.
- Live signed webhook behavior is the acceptance proof for customer-facing
  behavior.
- Boondi domain expected behavior comes from
  `/Users/caw-d/Downloads/Boondi_Intent_Scenario_Template.xlsx#Template_BA`,
  `/Users/caw-d/Downloads/BSS Boondi User Flow.html`,
  `/Users/caw-d/Downloads/Boondi_SoulDoc (2).html`, and
  `/Users/caw-d/Downloads/Boondi System Orchestration Blueprint (1).html`.
- Docs, MD files, Excel sheets, and prior notes define requirements and review
  expectations, but they are not proof that runtime behavior is working.
- If docs disagree with code or observed behavior, update the docs after proof.

## Target Architecture

Runtime-facing Boondi knowledge lives in skill folders:

```text
agents/boondi_support/skills/
  boondi-gifting/
    SKILL.md
  boondi-product-care/
    SKILL.md
  boondi-orders/
    SKILL.md
  boondi-store-aggregator/
    SKILL.md
  boondi-misc-policy/
    SKILL.md
```

The active runtime config selects these folder skills:

```yaml
agents:
  boondi_support:
    plugins:
      skills:
        - boondi-gifting
        - boondi-product-care
        - boondi-orders
        - boondi-store-aggregator
        - boondi-misc-policy
```

Expected live SDK payload after migration:

```json
"skills": [
  "boondi-gifting",
  "boondi-product-care",
  "boondi-orders",
  "boondi-store-aggregator",
  "boondi-misc-policy"
]
```

Other unrelated selected runtime/admin skills may also appear, such as
`gantry-admin`, but the Boondi business skill set must be the five domain skills
above.

`boondi-kb` must not remain selected after cutover.

## Ownership Boundary

- Runtime/framework owns: generic skill discovery, materialization, selected
  skill projection, SDK payload construction, and provider-native `Skill` tool
  wiring.
- Product/domain/agent owns: Boondi domain skill content, selected Boondi skill
  ids, customer-facing behavior expectations, and evidence docs.
- Prompt files own: compact universal routing, safety, and customer experience
  rules only.
- Skill/KB files own: progressively loaded domain playbooks that are useful to
  the LLM at answer time.
- MCP/tool contracts own: source-backed live facts and compact tool outputs.
- Config owns: selected Boondi skill ids through `agents.boondi_support.plugins.skills`.
- Docs own: human mapping, migration status, Template_BA traceability, and
  evidence.
- Must not be duplicated: runtime domain knowledge must not live in both
  `kb/*.md` and `skills/*/SKILL.md` as active sources.

Detailed rules:

- Gantry core remains generic. Do not hard-code Boondi skill names in core.
- Boondi domain knowledge stays under `agents/boondi_support/skills/`.
- Runtime skill bodies contain only LLM-useful playbooks.
- Human mapping, Template_BA traceability, phase status, and evidence stay under
  `agents/boondi_support/docs/`.
- MCPs remain the source for live product, stock, order, price, discount,
  serviceability, and delivery facts.
- `CLAUDE.md` remains compact universal routing/safety guidance, not a domain KB.
- Do not point runtime skills to sibling `../kb/*.md` unless materialization is
  changed to copy those assets. Today only the skill folder is copied.
- Use `plugins.skills` for these Boondi-owned agent-folder skills. Do not use
  `sources.skills` unless the skills are intentionally installed through the
  catalog/artifact store. Current target is agent-folder ownership.
- If `agents/boondi_support/kb/*.md` remains after migration, it must be clearly
  human-only source material. It must not contain runtime/progressive
  frontmatter that makes it look like an active skill.

## Testing Strategy

- Static/code checks first: settings parse/render, skill materialization, SDK
  option projection, progressive pointer context, and restricted native `Skill`
  tool availability.
- Unit/integration checks next: focused tests listed in Phase 2.
- Minimal focused live/runtime tests next: 3-5 signed webhook scenarios that
  prove domain skill selection, progressive loading, reply safety, and no
  `boondi-kb` payload.
- Cross-scenario regression next: the focused pack in Phase 5.
- Payload/log/trace checks: inspect `llm-sdk-query-args.json`, trace payloads,
  and Skill tool openings for each live proof row.
- Output/reply checks: inspect customer-visible replies for correctness,
  warmth-sensitive regressions, unsupported promises, and leakage.
- Full live Template_BA regression: do not run it early. The user has requested
  it only as the ultimate final phase after prerequisite phases pass.

## Execution Record

Completed on 2026-06-20:

- Phase 0 captured the starting state: active local runtime config selected
  `boondi-kb`, `boondi-kb/SKILL.md` was 3032 words, and ports `4710`, `8081`,
  and `8082` were free before editing.
- Phase 1 created five real progressive SDK skill folders:
  `boondi-gifting`, `boondi-product-care`, `boondi-orders`,
  `boondi-store-aggregator`, and `boondi-misc-policy`.
- Final skill word counts are: gifting 664, product-care 1011, orders 1036,
  store-aggregator 855, and misc-policy 402.
- Phase 2 added regression coverage for settings parse/render, skill
  materialization, progressive pointers, native `Skill` exposure, runner SDK
  options, and Boondi domain-skill content constraints.
- Phase 3 updated active `/Users/caw-d/gantry/settings.yaml` so
  `agents.boondi_support.plugins.skills` selects the five domain skills and no
  longer selects `boondi-kb`.
- Phase 4 focused live proof passed with isolated phones and evidence files:
  `/tmp/boondi-domain-skills-gifting-rerun.json`,
  `/tmp/boondi-domain-skills-product-care-rerun.json`,
  `/tmp/boondi-domain-skills-orders-rerun.json`,
  `/tmp/boondi-domain-skills-store-rerun.json`, and
  `/tmp/boondi-domain-skills-misc-rerun.json`.
- Phase 4 payload evidence showed selected skills
  `boondi-gifting`, `boondi-misc-policy`, `boondi-orders`,
  `boondi-product-care`, `boondi-store-aggregator`, and `gantry-admin`; it did
  not include `boondi-kb`. The always-on prompt contained progressive skill
  pointers and did not contain the full domain skill bodies or the old
  `Customer Care Knowledge Base` body.
- Phase 5 focused cross-regression passed after two targeted skill-content
  fixes. Final evidence:
  `/tmp/boondi-domain-skills-cross-regression-merged-rerun2.json`.
- Phase 5 strict reviewer command passed with 8 rows, 8 passed, 0 failed:
  `npx tsx agents/boondi_support/evals/review-template-ba-evidence.ts --evidence /tmp/boondi-domain-skills-cross-regression-merged-rerun2.json --expect-count 8`.
- Phase 6 removed the old monolithic runtime skill folder and duplicate
  `agents/boondi_support/kb/*.md` migration sources.

Focused cross-regression rows:

| Scenario | Reply | Tool evidence |
| --- | --- | --- |
| `pre-03-custom-pack-size` | Yes | No tool required |
| `pre-05-missed-window` | Yes | `sdk:Skill` |
| `pre-08-gst-logo` | Yes | `sdk:Skill` |
| `del-01-order-status` | Yes | `shopify-api.get_recent_orders_with_details` |
| `post-02-card-missing` | Yes | No tool required |
| `cafe-02-nearest-store` | Yes | `sdk:Skill` |
| `misc-02-repeat-opt-out` | Yes | No tool required |
| `agg-04-bill` | Yes | `sdk:Skill` |

Phase 6 cleanup classification:

- Historical evidence only:
  `agents/boondi_support/docs/boondi-kb-skill-architecture-plan.md`.
- Migration doc only: this file.
- Intentional legacy-negative test fixtures:
  `apps/core/test/unit/adapters/claude-config-materializer.test.ts`,
  `apps/core/test/unit/runtime/session-resume-runtime.test.ts`,
  `apps/core/test/unit/runner/agent-runner-ipc.test.ts`, and
  `apps/core/test/unit/config/agent-plugins-settings.test.ts`.
- Stale active references: none found in active settings or runtime skill
  folders.

Phase 7 execution:

- Confirmed Template_BA manifest count is 59.
- Confirmed source review files exist under `/Users/caw-d/Downloads/`.
- Verified current code supports `GANTRY_CORE_COUNT` in
  `scripts/boondi-runtime-stack.sh`.
- Started 5 local cores on ports `4710`-`4714` and temporarily set active
  warm-pool size and `max_bound_workers` to 12 for the run. After live testing,
  local warm-pool settings were restored to 3.
- The first 5-core run exposed a runtime defect: when the warm pool was empty,
  `runWarmPrewarm()` could throw before a worker was acquired, and the exception
  escaped before the existing cold-spawn fallback. Customer webhooks were
  accepted but some turns rolled back with no reply.
- Added the red/green regression
  `falls back cold when empty-pool prewarm fails before a worker is acquired`
  in `apps/core/test/unit/runtime/agent-spawn.test.ts`.
- Fixed `apps/core/src/runtime/agent-spawn.ts` so empty-pool prewarm failures
  are logged and then fall through to the cold-spawn path.
- Focused replay of previously failing rows passed:
  `/tmp/boondi-phase7-retry-gifting.json`,
  `/tmp/boondi-phase7-retry-product-care.json`,
  `/tmp/boondi-phase7-retry-orders.json`,
  `/tmp/boondi-phase7-retry-store.json`, and
  `/tmp/boondi-phase7-retry-misc.json`.
- Full 59-scenario sharded evidence was merged into
  `/tmp/boondi-template-ba-full-live-evidence.json`; all 59 scenario ids and
  phones were unique and all rows received replies.
- Strict reviewer initially found three tool-policy issues. Two were reviewer
  allow-list mismatches with the scenario contracts; the real product defect was
  `pre-05-apply-discount`, where the model called `validate_discount_code` with
  `discount_code` instead of the MCP schema field `code`.
- Updated the product-care skill to specify the `code` input field, replayed
  `pre-05-apply-discount` on a clean runtime, and replaced that row with
  `/tmp/boondi-template-ba-discount-rerun-clean.json`.
- Final strict reviewer passed with 59 rows, 59 passed, 0 failed:
  `npx tsx agents/boondi_support/evals/review-template-ba-evidence.ts --evidence /tmp/boondi-template-ba-full-live-evidence.json --expect-count 59`.
- Payload evidence from `llm-sdk-query-args.json` and
  `/tmp/gantry-llm-sdk-query-args.jsonl` showed the five domain skills plus
  `gantry-admin`, no `boondi-kb`, and no checked full skill-body markers in the
  always-on prompt.
- Runtime cleanup verified ports `4710`-`4714`, `8081`, and `8082` were free
  after stopping the test stacks.

## Migration Phases

Default phase statuses are `Pending`, `In progress`, `Blocked`, and `Done`.
Do not move to the next phase until evidence is recorded and the reviewer
decision is updated. Phase 7 is the ultimate final gate and must not start
until Phases 0-6 pass.

### Phase 0: Freeze Current Evidence

- Status: Done.
- Objective: preserve the current monolithic proof before removing
  `boondi-kb`.
- Changes allowed: evidence capture only; no code, prompt, config, or live
  runtime behavior changes.
- Evidence required:
  - Record current live payload shape: `skills:["boondi-kb","gantry-admin"]`.
  - Record current `boondi-kb/SKILL.md` word count and selected skill body risk.
  - Record latest passing Template_BA evidence bundle paths from the
    architecture evidence doc.
  - Confirm all local runtime servers are stopped before editing.
  - Add the evidence entry to this plan or the main Boondi evidence plan.
- Regression risk: none from this phase because it is read-only evidence
  capture.
- Reviewer decision: Passed.

### Phase 1: Create Real Domain Skill Folders

- Status: Done.
- Objective: convert each runtime-facing KB into a real SDK skill package.
- Changes allowed:
  - Create `agents/boondi_support/skills/boondi-gifting/SKILL.md`.
  - Create `agents/boondi_support/skills/boondi-product-care/SKILL.md`.
  - Create `agents/boondi_support/skills/boondi-orders/SKILL.md`.
  - Create `agents/boondi_support/skills/boondi-store-aggregator/SKILL.md`.
  - Create `agents/boondi_support/skills/boondi-misc-policy/SKILL.md`.
- Evidence required:
  - Each new skill folder has a valid `SKILL.md`.
  - Each `SKILL.md` frontmatter `name:` exactly matches its folder id.
  - Each `description:` is trigger-focused and compact.
  - Each `SKILL.md` has `disclosure: progressive`.
  - Word counts are recorded for every skill.
  - `rg` confirms no `Status:`, `Scope:`, `Source Scenarios`, or Template_BA
    table rows inside runtime skill bodies.
- Regression risk: content migration can drop operational guidance or warmth
  semantics even if payload wiring is correct.
- Reviewer decision: Passed.

Content source rules:

- Use the current cleaned `agents/boondi_support/kb/*.md` bodies as input.
- Do not blindly copy if any body still contains human-only metadata.
- Body must contain only runtime decision guidance.
- Do not include live facts that belong to MCPs.
- Treat `agents/boondi_support/kb/` as a temporary migration source only. After
  live proof, delete it or move it under docs as human-only source mapping.

### Phase 2: Add Regression Tests For Skill Split

- Status: Done.
- Objective: prove the architecture cannot silently fall back to one monolithic
  skill or lose progressive behavior.
- Changes allowed: focused unit/regression tests for settings parsing,
  materialization, progressive context, native Skill tool availability, and
  runner SDK options.
- Evidence required:
  - `apps/core/test/unit/config/agent-plugins-settings.test.ts` parses/renders
    multiple `plugins.skills` ids, including Boondi-style ids.
  - `apps/core/test/unit/adapters/claude-config-materializer.test.ts`
    materializes multiple declared agent-folder skills and proves an undeclared
    `boondi-kb` folder is inert.
  - `apps/core/test/unit/runtime/session-resume-runtime.test.ts` proves
    multiple progressive pointers are present and skill bodies are not injected.
  - `apps/core/test/unit/runner/native-sdk-skills.test.ts` proves restricted
    native surface still exposes `Skill` when multiple SDK skills are enabled.
  - `apps/core/test/unit/runner/agent-runner-ipc.test.ts` proves the runner
    receives all domain skills in `options.skills`.
  - Focused unit test command passes.
  - `npm run typecheck` passes.
- Regression risk: test expectations may accidentally encode Boondi behavior in
  Gantry core. Keep Boondi ids as fixtures only; no production hard-coding.
- Reviewer decision: Passed.

### Phase 3: Deactivate Monolith And Select Domain Skills

- Status: Done.
- Objective: make the runtime expose domain skills instead of `boondi-kb`.
- Changes allowed:
  - Replace `agents.boondi_support.plugins.skills: [boondi-kb]` with the five
    domain skill ids.
  - Apply the same desired-state update in the repo/runtime source used for live
    tests, including `/Users/caw-d/gantry/settings.yaml` when testing locally.
  - Leave the `boondi-kb` folder on disk only during the first cutover test, but
    do not select it.
- Evidence required:
  - Settings parse/render still passes after the desired-state update.
  - Local materialization test confirms `boondi-kb` is inert when undeclared.
  - No live success claim is made in this phase; live proof is Phase 4.
- Regression risk: wrong active settings source can make static proof pass while
  live runtime still selects `boondi-kb`.
- Reviewer decision: Passed.

### Phase 4: Live Payload Proof

- Status: Done.
- Objective: prove the live runtime payload is modular and progressive.
- Changes allowed: minimal focused signed webhook tests only; not the full
  Template_BA pack unless the user separately approves full live testing.
- Evidence required:
  - Run 3-5 signed webhook scenarios:
    `pre-06-gift-budget`, `pre-04-allergen-jain`, `del-01-order-status`,
    `cafe-02-nearest-store` or `agg-04-bill`, and `misc-03-franchise` or
    `misc-02-repeat-opt-out`.
  - `llm-sdk-query-args.json` is a latest-only object, not an appended array.
  - `options.skills` includes all selected domain skills.
  - Other unrelated runtime/admin skills may appear, such as `gantry-admin`,
    but are not part of Boondi business skill acceptance.
  - `options.skills` does not include `boondi-kb`.
  - Prompt includes progressive skill pointers.
  - Prompt does not contain full domain skill bodies.
  - For at least three representative domains, persisted trace payloads or SDK
    debug evidence show provider-native `Skill` opened the expected domain
    skill id, not `boondi-kb`.
  - Evidence files are stored under `/tmp/...` or a documented evidence
    directory.
- Regression risk: payload shape can be correct while reply quality regresses,
  so Phase 5 must still run.
- Reviewer decision: Passed.

### Phase 5: Focused Cross-Regression

- Status: Done.
- Objective: prove splitting skills did not break nearby scenarios.
- Changes allowed: focused cross-regression only; no broad prompt or MCP edits
  unless this phase finds a specific defect and reviewer approves a fix batch.
- Evidence required:
  - Run `pre-03-custom-pack-size`, `pre-05-missed-window`,
    `pre-08-gst-logo`, `del-01-order-status`, `post-02-card-missing`,
    `cafe-02-nearest-store`, `misc-02-repeat-opt-out`, and `agg-04-bill`.
  - Strict reviewer passes focused pack.
  - Human review confirms tone/semantics are not worse for known
    warmth-sensitive replies.
  - Payload proof still shows modular skills and no `boondi-kb`.
- Regression risk: a fix for one domain skill can shift another domain's
  behavior. Fix only classified defects, then rerun the affected focused pack.
- Reviewer decision: Passed.

### Phase 6: Remove Or Retire `boondi-kb`

- Status: Done.
- Objective: eliminate the workaround and avoid future accidental use.
- Changes allowed:
  - Delete `agents/boondi_support/skills/boondi-kb/` after all live checks pass.
  - Keep a deprecated runtime folder only if the reviewer explicitly asks for a
    short rollback window. If kept, it must remain unselected and have a dated
    removal note.
- Evidence required:
  - No active config selects `boondi-kb`.
  - No live payload lists `boondi-kb`.
  - Cleanup search is recorded.
  - Any remaining `boondi-kb` match is classified.
- Regression risk: stale active references can silently reselect the monolithic
  skill later.
- Reviewer decision: Passed.

Required cleanup check:

```bash
rg -n "boondi-kb|skills:\\s*\\[\"boondi-kb\"|Skill\\(boondi-kb\\)" \
  agents/boondi_support apps/core/test docs README.md
```

Any remaining match must be classified:

- historical evidence only
- migration doc only
- test fixture intentionally covering legacy behavior
- stale active reference to remove

### Phase 7: Ultimate Full Template_BA Live And Scaling Gate

- Status: Done.
- Objective: prove the completed architecture against all 59 Template_BA
  scenarios while exercising low-scale production-style concurrency: 5 runtime
  cores, each with 12 warm workers.
- Changes allowed:
  - Start and configure the required 5-core local runtime only after all earlier
    phases pass.
  - Enhance the Template_BA eval harness or add a small orchestrator if current
    tooling cannot safely distribute all 59 scenarios in parallel.
  - Make surgical fixes across code, MCPs, skills, KBs, prompts, eval harness,
    runtime config, or docs only when a live failure proves the need.
  - Rerun the smallest affected subset after each fix, then rerun this full
    phase once the defect is fixed.
- Evidence required:
  - Confirm manifest count is 59 from
    `agents/boondi_support/evals/template-ba-live-scenarios.json`, whose source
    is `/Users/caw-d/Downloads/Boondi_Intent_Scenario_Template.xlsx#Template_BA`.
  - Confirm the review sources are available:
    `/Users/caw-d/Downloads/BSS Boondi User Flow.html`,
    `/Users/caw-d/Downloads/Boondi_SoulDoc (2).html`, and
    `/Users/caw-d/Downloads/Boondi System Orchestration Blueprint (1).html`.
  - Verify the multi-core launch path from current code before starting it; do
    not trust old docs or memory.
  - Run 5 cores x 12 warm workers, then send all 59 scenarios with isolated
    customer phones and reply-gated evidence collection.
  - Record one evidence row per scenario with webhook status, runtime/core
    ownership, payload path, trace path, reply text/path, tool stages, opened
    Skill id when applicable, latency, and reviewer decision.
  - Run the strict Template_BA evidence reviewer with `--expect-count 59`.
  - Human-review the replies against Template_BA sample lines, Shreya
    suggestions, and the Boondi user-flow/soul/system docs for semantic
    closeness, warmth, helpfulness, and detail level.
  - Inspect `llm-sdk-query-args.json` or equivalent per-call payload capture to
    prove domain skills are selected, `boondi-kb` is absent, and full skill
    bodies are not in always-on prompt context.
  - After the run settles, confirm no delayed duplicate replies, missing
    outbound replies, cross-customer context leaks, queue ownership failures, or
    worker/runtime crashes.
  - Stop all servers and verify local ports are free.
- Regression risk: high. This phase intentionally stresses both behavior and
  scaling architecture. Any failure must be classified before fixing so a
  scenario-specific change does not break another scenario.
- Reviewer decision: Passed after runtime fallback fix and focused discount
  replay. Final evidence:
  `/tmp/boondi-template-ba-full-live-evidence.json`.

Phase 7 failure classification:

- Tone/semantic gap
- Missing source data
- Unsupported promise
- MCP/tool contract gap
- Prompt/router issue
- Skill/KB content issue
- Customer-output sanitizer issue
- Runtime queue/worker/core ownership issue: found and fixed for empty-pool
  prewarm failures before cold fallback.
- Eval harness/evidence collection issue

Phase 7 acceptance requires:

- All 59 scenarios receive exactly one customer-safe reply.
- Strict reviewer passes with `--expect-count 59`.
- Human review passes or records accepted tradeoffs for warmth/semantics.
- No internal/process/source leakage.
- No unsupported promises.
- No broad unnecessary MCP/tool fanout.
- No cross-customer context leakage.
- No duplicate outbound replies after settle.
- 5-core x 12-worker runtime remains stable during and after the run.
- Evidence paths and reviewer decisions are recorded in this plan or the main
  Boondi evidence doc.

## Surface Impact Matrix

| Surface | Impact | Reason |
| --- | --- | --- |
| Runtime behavior | Changed | Boondi will expose multiple domain SDK skills instead of one monolithic skill. |
| `settings.yaml` | Changed | `agents.boondi_support.plugins.skills` must list domain skill ids and remove `boondi-kb`. |
| Postgres/runtime projection | Read-only/observable | Runtime selected skill context should reflect configured skills; no schema change expected. |
| Control API | Unchanged by design | Existing settings/skill surfaces already support multiple ids. |
| CLI | Unchanged by design | Existing settings parse/render should be enough. |
| SDK/contracts | Changed | `options.skills` should contain five domain skills; SDK API shape unchanged. |
| Gantry MCP tools/admin skill | Unchanged by design | No new admin tool required. |
| Shopify MCP | Unchanged by design | Still source of live product/order/discount facts. |
| CRM MCP | Unchanged by design | Still not used for fresh order support or live lead capture unless separately designed. |
| Channel/provider adapters | Unchanged by design | Same signed Interakt webhook proof path. |
| Docs/prompts | Changed | Update Boondi evidence docs and remove monolithic-skill guidance. |
| Audit/events | Read-only/observable | Live traces should show `Skill` usage and selected skill ids. |
| Tests/verification | Changed | Add focused unit tests, live payload/reply evidence, and the final all-59-scenario load-style gate. |

## Token, Cost, And Rate-Limit Discipline

- Reuse Phase 0 evidence before generating new live evidence.
- Do not run broad live suites after every small edit.
- Keep skill bodies compact and progressive; do not solve routing by dumping
  examples into always-on prompt context.
- Prefer deterministic static/unit checks before LLM/API calls.
- Cap live testing to the minimal focused pack until payload shape is proven.
- Run the all-59-scenario live/load gate only once earlier phases pass, then
  rerun full only after meaningful final-batch fixes. For small fixes discovered
  during Phase 7, rerun the smallest affected subset before repeating the full
  gate.

## Risk Controls

- Do not reduce operational detail during the split unless a live test proves it
  is redundant.
- Do not use `kb/*.md` as runtime references from inside `SKILL.md` unless
  those files are copied into the materialized skill folder.
- Do not keep both `kb/*.md` and `skills/*/SKILL.md` as competing runtime
  sources of truth.
- Do not claim success from static tests. Live signed webhook payload and reply
  evidence is required.
- Keep live test batches small until payload shape is correct.
- Use Phase 7 concurrency only after focused proof passes; a 60-worker run must
  not be the first place basic skill wiring is debugged.
- Stop all local servers after live tests and verify ports are free.

## Rollback And Cleanup

- Old path removed: `agents/boondi_support/skills/boondi-kb/` after live proof,
  unless the reviewer explicitly approves one short rollback window.
- Duplicate source removed: `agents/boondi_support/kb/*.md` must be deleted or
  moved under docs as human-only source mapping after proof.
- Docs updated: this plan and any Boondi evidence docs must reflect the final
  selected-skill architecture.
- Stale references searched: run the Phase 6 cleanup search and classify every
  remaining match.
- Generated artifacts handled: evidence files may live under `/tmp/...` during
  proof, but final evidence paths must be recorded in this plan or the main
  evidence doc.
- No commit/stage unless explicitly requested.

## Architecture Decisions

1. Use `plugins.skills` for this migration because these are Boondi-owned
   agent-folder skills.
2. Prefer deleting `boondi-kb` after live proof. Keeping it as a non-selected
   folder is acceptable only for one short review window.
3. Prefer deleting `agents/boondi_support/kb/*.md` or moving them under docs
   after the split is proven. Do not keep them as a parallel runtime source.

## Verification Commands

Static and unit checks:

```bash
npm run test:unit -- \
  apps/core/test/unit/config/agent-plugins-settings.test.ts \
  apps/core/test/unit/adapters/claude-config-materializer.test.ts \
  apps/core/test/unit/runtime/session-resume-runtime.test.ts \
  apps/core/test/unit/runner/native-sdk-skills.test.ts \
  apps/core/test/unit/runner/agent-runner-ipc.test.ts

npm run typecheck

git diff --check
```

Live focused proof:

```bash
npm run dev:boondi-runtime

npx tsx agents/boondi_support/evals/run-template-ba-live.ts \
  --id pre-06-gift-budget \
  --out /tmp/boondi-domain-skills-gifting.json \
  --wait-ms 120000

npx tsx agents/boondi_support/evals/run-template-ba-live.ts \
  --id pre-04-allergen-jain \
  --out /tmp/boondi-domain-skills-product-care.json \
  --wait-ms 120000

npx tsx agents/boondi_support/evals/run-template-ba-live.ts \
  --id del-01-order-status \
  --out /tmp/boondi-domain-skills-orders.json \
  --wait-ms 120000
```

After live runs, inspect `llm-sdk-query-args.json` and stop the runtime. Verify
ports `4710`, `8081`, and `8082` are free.

Ultimate full Template_BA and scaling gate:

```bash
node -e "const m=require('./agents/boondi_support/evals/template-ba-live-scenarios.json'); if (m.scenarioCount !== 59 || m.scenarios.length !== 59) throw new Error('Template_BA count mismatch'); console.log('Template_BA scenarios:', m.scenarioCount)"

npx tsx agents/boondi_support/evals/run-template-ba-live.ts \
  --dry-run \
  --all
```

Before executing Phase 7, verify or add the parallel orchestration path. The
current `run-template-ba-live.ts` sends scenarios sequentially, so 5 cores x 12
workers requires either a proven external orchestrator or an eval-harness
enhancement that safely distributes all 59 scenarios and merges evidence.

After the Phase 7 evidence file exists:

```bash
npx tsx agents/boondi_support/evals/review-template-ba-evidence.ts \
  --evidence /tmp/boondi-template-ba-full-live-evidence.json \
  --expect-count 59
```

## Self-Review

Findings from self-review:

- Strong: the plan is code-grounded and uses the existing materialization path
  instead of proposing a new Gantry mechanism.
- Strong: the plan avoids hard-coding Boondi behavior in Gantry core.
- Strong: the plan requires live signed webhook payload and reply evidence, not
  only static tests.
- Fixed during review: expected payload no longer treats `gantry-admin` as part
  of the Boondi business skill set.
- Fixed during review: `plugins.skills` is now an explicit architecture
  decision, not an open question.
- Fixed during review: live proof must show individual domain skills are
  actually opened through provider-native `Skill`, not merely listed.
- Fixed during second review: Phase order now adds regression tests before
  switching live desired state, and live payload proof is isolated to Phase 4.
- Fixed during second review: `gantry-admin` is consistently treated as an
  unrelated runtime/admin skill, not a Boondi business skill requirement.
- Fixed during second review: `kb/*.md` cleanup is no longer an open-ended
  decision; the default is delete or move under docs after live proof.
- Fixed during second review: exact static and live verification commands are
  documented.
- Remaining risk: the plan still depends on careful content migration. If a
  domain skill body drops regression-proven wording, behavior can regress even
  when payload shape is correct. Phase 5 cross-regression is the guard for this.
- Remaining risk: if `kb/*.md` remains with skill-like frontmatter after
  migration, humans may confuse it with runtime skills. Phase 6 must clean that
  up.

## Live Acceptance Criteria And Final Acceptance Gate

The migration is accepted only when all are true:

- Live payload lists domain skills and not `boondi-kb`.
- Progressive pointer exists for each selected domain skill.
- Full domain skill bodies are absent from always-on prompt payload.
- Relevant live replies pass strict review and human warmth/semantics review.
- Focused cross-regression passes.
- Ultimate all-59-scenario live/load gate passes after Phases 0-6 pass.
- No internal/process/source leakage.
- No unsupported promises.
- No broad MCP/tool fanout.
- Evidence paths and reviewer decision are recorded.

Evidence table:

| Scenario | Runtime evidence | Payload/log evidence | Output evidence | Decision |
| --- | --- | --- | --- | --- |
| `pre-06-gift-budget` | `/tmp/boondi-domain-skills-gifting-rerun.json` | Domain skills selected, no `boondi-kb` | Reply received | Passed |
| `pre-04-allergen-jain` | `/tmp/boondi-domain-skills-product-care-rerun.json` | Domain skills selected, no `boondi-kb` | Reply received | Passed |
| `del-01-order-status` | `/tmp/boondi-domain-skills-orders-rerun.json` | Domain skills selected, no `boondi-kb` | Reply received | Passed |
| `cafe-02-nearest-store` / `agg-04-bill` | `/tmp/boondi-domain-skills-store-rerun.json`; `/tmp/boondi-domain-skills-cross-regression-merged-rerun2.json` | `sdk:Skill` evidence where applicable | Replies received | Passed |
| `misc-03-franchise` / `misc-02-repeat-opt-out` | `/tmp/boondi-domain-skills-misc-rerun.json`; `/tmp/boondi-domain-skills-cross-regression-merged-rerun2.json` | `sdk:Skill` avoided for opt-out repeat | Replies received | Passed |
| Phase 7 all 59 Template_BA scenarios | `/tmp/boondi-template-ba-full-live-evidence.json`; shard files `/tmp/boondi-template-ba-full-live-shard-1.json` through `/tmp/boondi-template-ba-full-live-shard-5.json`; focused rerun `/tmp/boondi-template-ba-discount-rerun-clean.json` | Five domain skills selected, `boondi-kb` absent, full skill-body markers absent from checked always-on prompt payloads; `validate_discount_code` rerun used `{code:"BSSDIWALI20"}` | 59 replies received, no duplicate scenario ids or phones, strict reviewer 59/59 | Passed |

## Final Reviewer Decision

- Approved: Yes.
- Approved with changes: No.
- Blocked: No.
- Reason: Phases 0-7 passed. The final all-59 Template_BA live/load gate passed
  after the empty-pool warm-worker fallback fix and a focused discount-tool
  schema guidance fix. Final strict reviewer result: 59 rows, 59 passed,
  0 failed.
- Follow-up: the clean replay still logged a post-output warning
  (`Agent error after output was sent, skipping cursor rollback to prevent
  duplicates`) after durable outbound evidence existed. This did not create a
  duplicate or missing reply in the acceptance evidence, but it is worth a
  separate runtime-noise cleanup task.
