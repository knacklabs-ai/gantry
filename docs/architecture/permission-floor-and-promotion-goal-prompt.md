# Permission floor + command-class promotion — goal prompt

Status: SCOPED via grill (2026-07-20). Next lane after the incident closeout.
Stay-direct posture confirmed; this lane makes the live default safer AND kills
the novel-task prompt flood.

## Why (the two observed problems)

1. **Prompt flood on novel tasks.** During the 2026-07-20 render, RunCommand
   permissions bounced to the human 52 times (`decidedBy:5759865942`,
   allow_once ×49 + allow_persistent_rule ×2) alongside 7 `auto_classifier`
   allows. Each novel shell command (npm install, chrome download, ffmpeg,
   render) re-prompted because "allow for future" persists too narrowly.
2. **No deterministic floor under the classifier.** Live runs `auto` — the LLM
   classifier is the only gate on shell. Plain `auto` has no deterministic
   read-only pre-gate; every decision rides on the model (which also logs on
   the currently-failing publishRuntimeEvent path).

## Locked decisions (grill, 2026-07-20)

1. **Posture: stay `direct`.** No srt migration. On this trusted single-host
   box `requiresEnforcingSandbox` is false by design
   (`security-posture.ts:49-50`); the egress-escape gap is not the threat
   model here. srt is only unit-tested locally — flipping it is out of scope.
2. **Ship BOTH levers:** deterministic safety floor + prompt-flood fix.
3. **`auto_strict` becomes the new-agent default permission mode** — adds the
   deterministic read-only pre-gate (`shared/auto-permission-read-only-gate.ts`)
   + YOLO denylist backstop (`shared/yolo-mode-policy.ts`) UNDER the classifier.
   Read-only ops stop prompting; shell still consults the classifier.
4. **Promotion = command-NAME class, user-confirmed, conversation+agent
   scoped, never global, never auto-widened.** Approving `npm install remotion`
   offers "Allow all `npm install …` in this conversation?"; the user sees and
   confirms the class before it persists.
5. **Tight scope.** Permission floor + promotion ONLY. Env-facts / "legible
   boundaries" defers to media-render Stage 5 (one shared EnvironmentFacts, not
   two). The audit-write fail-loud fix (#5) is a separate tiny lane.

## Concrete seams (grounded in the tree)

- Permission mode: `permission_mode` per-agent, validated `ask|auto|auto_strict`
  (`config/settings/runtime-settings-parser.ts:361-370`). Effective resolution
  `resolveEffectivePermissionMode(...) ?? 'ask'` (`shared/permission-mode.ts:9`);
  spawn default `input.permissionMode ?? 'ask'` (`agent-spawn.ts:573`).
- Classifier eligibility: `Bash`/`RunCommand` + non-gantry MCP only
  (`application/permissions/permission-classifier.ts` `isPermissionClassifierEligible`).
- Decision integration + `allow_persistent_rule` option:
  `runtime/ipc-permission-classifier-decision.ts:90-195` (option list
  `:183-190`); decisionMode enum `domain/types.ts:175`.
- Rule matcher: declarative tool-rule (tool-glob + arg-regex),
  `runner/tool-gate-core.ts:58-111`.

## Stages (each leaves tree green)

### Stage 1 — auto_strict default for new agents
- New-agent settings default permission mode `ask` → `auto_strict`
  (new-agent creation path `config/settings/runtime-settings.ts:142-151`);
  spawn fallback stays `ask` for anything unset by settings.
- Confirm the deterministic read-only pre-gate + YOLO backstop run BEFORE the
  classifier for `auto_strict` (they already exist — wire/verify, don't
  rebuild).
- Tests: new agent gets `auto_strict`; read-only tool auto-allowed with NO
  classifier call and NO human prompt; a denylisted command still fails closed;
  existing agents' explicit modes untouched.

### Stage 2 — command-class promotion
- On `allow_persistent_rule` for a `Bash`/`RunCommand`, derive the command-NAME
  class (base command/verb, e.g. `npm install`), present it to the user for
  explicit confirmation ("Allow all `<class> …` in this conversation?"), and on
  confirm persist a declarative tool-rule scoped to conversation+agent.
- Persist through the revision-owned desired-state writer (survives restart);
  never global, never auto-widened. Reuse `tool-gate-core` matching — the saved
  rule matches the verb, not exact args.
- Subsequent same-class commands match the rule → auto-allowed, no re-prompt.
- Tests: class derivation (varying args → same class; different verb → no
  match); confirm-required before persist; conversation+agent scope isolation
  (rule in convo A never matches convo B / other agent); restart survival;
  destructive-verb classes still surface the confirm (no silent broadening).

## Verification
- Unit: Stages 1-2 above. Full apps/core unit + typecheck green.
- Manual smoke: a novel multi-command task prompts ONCE per command class, not
  once per command; read-only ops never prompt.
- Test fixtures avoid real key prefixes (scanner FP classes).

## Non-goals
- No srt migration; no change to `direct` posture or the SDK seatbelt.
- No env-facts / legible-boundaries work (media-render Stage 5 owns it).
- No audit-write fix (separate lane).
- No classifier-model or eligibility-set changes; no widening what the
  classifier is allowed to auto-decide.
- No global or cross-conversation permission rules, ever.

## Sequencing
- Starts after the route-loader incident-closeout lane commits (they don't
  overlap in files, but keep one incident lane landing at a time).
- Parallel-safe with ponytail and media (different subsystems).
