# Media render capability + environment-facts guidance — goal prompt

Status: RESTAGED v2 (2026-07-20) after plan-validation round 1 returned NOT
SAFE AS STAGED — see `media-render-plan-validation.md` for the full findings;
this version incorporates every correction. Round-2 validation gate required
before implementation.

## Root cause (one sentence)

The agent sandbox is provisioned blind: capabilities are discovered by runtime
failure, not provisioned up front or declared absent — the Chrome/Mach failure
was merely the layer where in-sandbox improvisation became impossible.

## The observed failure chain (live incident, 2026-07-20)

1. Render outputs written to ephemeral temp dirs got wiped (no durable
   convention communicated).
2. `npm install` hit the host's root-owned `~/.npm` (no seeded, writable
   package cache).
3. Remotion's render-time download of Chrome Headless Shell died in the
   sandbox (proxy-unaware DNS → ENOTFOUND).
4. TRUE BLOCKER: Chrome could not launch — `bootstrap_check_in ...
   MachPortRendezvousServer: Permission denied (1100)` + crashpad/profile
   writes to denied paths.
5. Artifact-store writes rejected while workspace-path attachments worked
   (fixed on main: `3da53d9f6`, `e803e21fa`, `14d79783d`; loader dedup runs
   as a separate closeout lane).

## Empirical proof (2026-07-20, this machine: darwin-arm64)

A full Remotion 4.0.290 render (210/210 frames → 916 KB MP4) succeeded INSIDE
`@anthropic-ai/sandbox-runtime@0.0.52` (srt) with:

- Pinned `chrome-headless-shell` (Chrome for Testing 147.0.7727.57) — no
  render-time download.
- A wrapper script passed as `--browser-executable` appending
  `--single-process --no-sandbox`. Single-process Chrome never registers the
  MachPortRendezvousServer; srt exposes mach-lookup only (no mach-register
  key), so multi-process Chrome is impossible under srt by construction.
- `HOME`/`TMPDIR` inside the sandbox `allowWrite` root.
- srt network config: `allowLocalBinding: true` (DevTools websocket) AND
  `allowMachLookup` gaining `com.apple.SystemConfiguration.configd` (without
  it Chrome's net stack spins on `SCDynamicStoreCreate` and DevTools never
  comes up). Keys nest INSIDE `network` (flat keys silently ignored).
- CORRECTION vs v1: this is TWO deltas against the current tree, not one —
  gantry's warm template pins `allowLocalBinding` to literal `false`
  (`runner-sandbox-provider.ts:21-26`) with unit tests asserting it. Local
  binding must become an explicit, media-gated effective-sandbox input, not a
  global flip. The `configd` addition is a deliberate, recorded sandbox-policy
  expansion (not "benign by assertion").

This proof covers one machine, one Chrome version, srt mode only. It does NOT
by itself support a general out-of-box claim — see the platform matrix and
hard gates below.

## Locked decisions (user, 2026-07-20 — unchanged)

1. **Out-of-box capability** on supported platforms (matrix below).
2. **Carrier = semantic capability + skill**, availability declared never
   discovered-by-failure.
3. **Full pre-provision at setup** (~400 MB), first render fast and offline.
4. **Generalize via environment-facts guidance**.
5. **Lane runs now, parallel with ponytail** (user accepts merge risk).

## Scope refinements (v2, from validation — defaults; overturn explicitly)

- **Supported platform matrix v1**: `darwin-arm64` (proven) and `linux-x64`
  (CI-verifiable), each with its own pinned source URL/sha256/layout in the
  provisioning manifest. Everything else (incl. Windows — srt rejects it) =
  HONEST UNAVAILABLE: doctor and environment-facts state it; setup does not
  select the capability; admission never claims it. No silent selection on a
  platform the smoke can't verify.
- **Direct-mode scope**: Anthropic SDK lane only. Direct-mode DeepAgents
  fails closed on shell authority by design
  (`deepagents-shell-filesystem-guard.ts:102-140`) and stays honest-
  unavailable; both lanes work under `sandbox_runtime`. No new enforcing
  DeepAgents command lane in this goal.
- **Executable surface = one facade**: a Gantry-owned, hash-pinned
  `media-render` CLI facade with narrow subcommands (`render`, `encode`,
  `gif`, `slideshow`) is the ONLY user-facing binding. It resolves the pinned
  Remotion CLI, Chrome wrapper (flag-enforcing), and ffmpeg from the
  activated toolchain; its preflight calls the toolchain inspector. Chrome
  and ffmpeg are never direct user actions.
- **No 400 MB copies per render**: the toolchain (browser, ffmpeg, warm
  Remotion project with node_modules) is a read-only content-addressed
  activation under `ARTIFACTS_DIR/toolchains/<manifest-hash>`; renders copy
  only a small writable composition skeleton into the workspace and resolve
  pinned deps from the activated root (controlled symlink created by the
  facade). Runtime install/download remains forbidden.
- **npm only** — the repo has no pnpm path; the v1 "pnpm equivalent" cache
  claim is dropped.
- Durable outputs: `<workspace>/media/`, delivery via #234 workspace-direct
  path (≤25 MB). Artifact store untouched.

## Restaged implementation (5 stages; each leaves tree green)

### Stage 1 — sandbox + env prerequisites

- Add a media-gated effective-sandbox requirement carried in
  `RunnerSandboxSpawnInput`/effective profile: `allowLocalBinding: true` ONLY
  for runs with `media.render` selected; nested `configd` mach lookup.
- Per-spawn workspace-owned paths for EVERY spawn: `<workspace>/.gantry/home`
  (HOME), `<workspace>/.gantry/tmp/<run>` (TMPDIR/TMP/TEMP),
  `<workspace>/.cache/npm` (`npm_config_cache`) — created in
  `agent-spawn-helpers.ts` AND forwarded through the Claude SDK adapter's
  env boundary (`runner/runtime-env.ts` `buildSdkEnv` currently drops
  HOME/cache keys — must forward the approved media env keys into
  `options.env`; no SDK package changes).
- Tests: non-media runs keep local binding false; media srt config true;
  direct SDK env receives exactly the approved workspace paths.

### Stage 2 — workstation provisioner + toolchain inspector

- NEW dedicated setup provisioner (the existing toolchain bake is fleet-only,
  npm-only, rejects system packages — reuse its conventions: normalized
  relative paths, sha256 manifest/content hashes, temp materialization,
  atomic activation, quarantine, idempotent manifest identity — NOT its
  executor; avoid Uint8Array whole-file buffering for the browser archive).
- Per-OS/arch manifest: exact Chrome + ffmpeg source URLs, versions, sha256,
  archive layout, executable paths, wrapper hash, Remotion lockfile hash,
  smoke contract. Activation under `ARTIFACTS_DIR/toolchains/<hash>`;
  provision-status record in Gantry-owned data, never the agent workspace.
- One-time 2-frame enforcing-srt smoke render, result recorded.
- Setup flow: new resumable `toolchains` step AFTER `group`, BEFORE `verify`
  (update `OnboardingStep` union, `FULL_SEQUENCE`, dispatcher, labels/recap,
  state persistence, setup + doctor tests). Setup completion blocks on
  supported platforms if provisioning fails.
- Doctor = idempotent INSPECTOR only: validates manifest/inventory, reports
  one repair action; never downloads, mutates desired state, or renders.
- No `media.render` selection yet in this stage.

### Stage 3 — capability, composite inventory, durable selection

- Semantic definition backed by the ONE facade binding (note:
  `buildLocalCliSemanticCapability` emits a single binding and hardcodes
  `filesystem: credential_read` — extend or bypass it; the toolchain root
  projects READ-ONLY via an explicit runtime-asset path in the
  capability/runtime-access contract, NOT by mislabeling it a credential
  dir).
- NEW composite verified worker-capability inventory: fixed-image inventory
  (immutable image content, unchanged semantics) MERGED with a verified
  provisioned-toolchain inventory. One inspector feeds all five consumers:
  spawn admission, job readiness, worker advertisement, doctor, prompt
  environment facts. Media entry exists only when platform/arch, manifest,
  file hashes, exec modes, warm-template marker, and smoke record ALL
  verify. Cache verification at setup/startup; invalidate on manifest/file
  metadata change; never hash 400 MB per spawn.
- Out-of-box selection is a PERSISTENT desired-state operation: setup
  registers the reviewed tool definition, attaches its source, durably
  selects `media.render` for the new agent, appends the settings revision,
  reconciles Postgres, syncs `settings.yaml`. Selection happens ONLY after
  verification. (New agents currently start with empty sources/capabilities
  — `runtime-settings.ts:142-151`.)

### Stage 4 — provider-neutral selected skill

- `media-render/SKILL.md` seeded into the durable reviewed skill
  catalog/artifact store and SELECTED for the new agent (bundled Claude
  skills are filtered by selected ids, and DeepAgents resolves only durable
  selected artifacts — the durable path covers both providers with no new
  source abstraction).
- Recipe invokes ONLY the facade; copies only the composition skeleton;
  writes/delivers from `<workspace>/media/`.

### Stage 5 — run-qualified environment facts + closeout

- Typed `EnvironmentFacts` input added to prompt compilation
  (`CompilePromptProfileOptions` → deterministic renderer inside the
  operating-guidance section; threaded via `compileSpawnSystemPrompt`).
  Facts computed BEFORE compilation from: verified inventory inspector,
  workspace root, effective provider (direct SDK vs outer srt), effective
  sandbox settings. Inline agents get inline-lane facts, not worker claims;
  locked agents get safe physical facts without capability-request guidance.
  Facts are provider-qualified ("media facade uses single-process Chrome
  under sandbox_runtime"), never blanket claims; unavailable states declared
  explicitly. Preserve section budgets; test truncation/determinism.
- Focused tests + srt smoke.

## Hard gates (unchanged in spirit, sharpened)

1. Scripted enforcing-srt smoke must produce a playable MP4.
2. **Direct-mode gate**: a real direct Anthropic-SDK agent renders a playable
   MP4 BEFORE direct/Anthropic inventory advertises the capability. (The
   tree passes no repo-owned mach-lookup list to the SDK sandbox; the srt
   proof predicts nothing here.)
3. A `sandbox_runtime` DeepAgents render is its own gate if that lane is
   claimed.

## Ponytail collision plan (validated against the live worktree)

- DO NOT touch ponytail Phase 4's contract files (`openapi-*schemas.ts`,
  `packages/contracts/src/jobs|settings`, `packages/sdk/*`). No new public
  DTO: media setup writes the EXISTING generic agent `sources`/`capabilities`
  settings shapes through `SettingsDesiredStateService`. If a public
  media/toolchain status DTO is ever wanted, defer until AR3 lands, then
  contracts-first through the new schema helper.
- KNOWN 4-file conflict with ponytail's committed Phase 1-3 work:
  `setup-flow-state.ts`, `setup-flow-final-steps.ts`,
  `setup-flow-simplified.test.ts`, `runtime-setup-doctor.e2e.test.ts`. User
  accepted this risk; keep the media diff in these files minimal and
  mechanical (one step insertion) to make the eventual ponytail merge cheap.

## Surface Impact Matrix

| Surface | Classification | Reason |
| --- | --- | --- |
| Runtime behavior | Changed | Verified media facade, media-gated local binding, spawn env, admission path. |
| `settings.yaml` | Changed | New agents get attached skill/tool sources + durable `media.render` selection. |
| Postgres/runtime projection | Changed | Reviewed definitions + bindings match latest desired-state revision. |
| Control API | Unchanged by design | Generic settings/capability shapes suffice; no media DTO. |
| SDK/contracts | Unchanged by design | No new wire shape; avoid ponytail Phase 4 files. |
| CLI | Changed | Resumable setup `toolchains` step + doctor inspect/repair action. |
| Gantry MCP/admin skill | Read-only/observable | Existing catalog/settings tools expose the selection. |
| Channel/provider adapters | Unchanged by design | Delivery stays on the workspace-direct path. |
| Docs/prompts | Changed | Selected skill, environment facts, setup/doctor docs, platform matrix. |
| Audit/events | Changed | Provision/integrity/smoke/selection evidence as structured events. |
| Tests/verification | Changed | Provision+hash idempotence, composite inventory, admission, settings round trip, both skill projections, prompt facts, srt smoke, direct live gate. |
| Transient approval | Unchanged by design | Out-of-box = persistent new-agent selection, not allow-once. |
| Persistent capability selection | Changed | Select only after verified provision; keep settings/revision/Postgres in sync. |

## Non-goals

- No host-side render service; no CDP screencast.
- No mach-register relaxation, no seatbelt profile surgery, no global
  local-binding flip.
- No S3/artifact-store changes; no channel media APIs.
- No render-time downloads, ever.
- No enforcing direct-mode DeepAgents command lane.

## Validation history

- Round 1 (2026-07-20): NOT SAFE AS STAGED — 5 contract crossings, 13
  contradicted assumptions; full report in
  `media-render-plan-validation.md`. This v2 incorporates all corrections.
- Round 2: REQUIRED before implementation.
