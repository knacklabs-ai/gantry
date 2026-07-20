# Agent E2E CI Merge Gate — goal prompt

Status: SCOPED via grill (2026-07-20). Full build as ONE goal (user decision).
Mandatory plan-validation gate before implementation.

**Hard exclusion:** `i-have-adhd` is a conversation-only communication skill. It
is NEVER copied, installed, inspected, fixtured, or asserted by any Gantry E2E
test. A guard test asserts zero references to it in fixtures/manifests/prompts/
snapshots/assertions.

## Why

Releases are getting risky without real-world testing. Unit tests pass but the
composed runtime (real image → real agent turn → skill/MCP/permission/capability
→ audit) is unproven per-PR. This session's incidents (route corruption, render
sandbox, permission flood, silent audit loss) all slipped through because nothing
exercised the packaged runtime end to end.

## What already exists (dedup — do NOT rebuild)

Deep unit + integration coverage ALREADY exists for the granular logic:
- Permissions: `permission-approval-ipc.integration.test.ts`,
  `permission-promotion-postgres.integration.test.ts`, units for
  `auto-permission-read-only-gate`, `yolo-mode-policy`, `permission-classifier`
  (unit + runtime), `tool-gate-core`, `ipc-locked-permission-denial`,
  `tool-permission-gate`, `permission-timeout`, `permission-tool-rules`.
- Capabilities: `fleet-capability-chaos-combo.postgres.integration.test.ts`,
  `fleet-capability-state-repositories.integration.test.ts`,
  `capability-secret-repository/service`, `agent-capability-administration-service`,
  `config/preflight`.

THE GAP is not logic coverage — it's that (a) `test:integration:postgres` is NOT
in CI (this granular coverage gates nothing today), and (b) nothing proves the
pieces composed in a real packaged runtime with a real agent turn.

## Locked decisions (grill, 2026-07-20)

1. **Full build, one goal** (not staged).
2. **Granular permission/capability cases run at the INTEGRATION layer**
   (deterministic, no model credentials, fast) — each mode, each decision path,
   each capability lifecycle. The packaged E2E adds only a THIN real-turn proof
   per area. No duplication.
3. **Wire the omitted `test:integration:postgres` lane into CI** — the cheapest
   real-world win; existing postgres-integration permission/capability tests
   start gating immediately.
4. **Policy classifier = explicit path-map + labeled override.** A checked-in
   config maps path globs → risk area (provider/model/skill/MCP/capability/
   runtime). A changed path matching none is UNKNOWN → fails closed, BUT an
   `e2e-reviewed` label lets a maintainer override per-PR after eyeballing. The
   path-map is the single source of truth, extended as the tree grows.
5. **Hermetic is the always-on required gate; live is label-gated.** So a
   provider outage or missing model credential blocks only `live-agent-e2e`-
   labeled PRs, never routine ones. Live lane may exceed the 15-min target;
   hermetic required checks target 15 min with warm caches + parallel slicing.

## Granular PERMISSION matrix (integration layer — deterministic, no creds)

Modes:
- `ask` (default): every eligible tool prompts human; nothing auto-decided.
- `auto`: classifier consulted for Bash/RunCommand + 3P MCP; allow → auto_classifier
  (allow_once); ask → human; NO deterministic read-only gate.
- `auto_strict`: deterministic read-only pre-gate auto-allows read-only WITHOUT a
  classifier call; YOLO denylist backstop blocks denylisted; classifier for the rest.

Decision paths (each an assertion):
- auto_classifier ALLOW → recorded, no prompt, `permission.classifier_decision` allow.
- auto_classifier ASK → falls through to human prompt.
- classifier UNAVAILABLE/failure → fail-safe to human (decision `ask`), logged.
- YOLO denylist hit → blocked + `permission.yolo_denylist_hit` event.
- read-only deterministic gate (auto_strict) → auto-allow, NO classifier call made.
- Locked-agent fail-closed → authority-changing IPC denied at parent boundary
  (`denied_by_profile`) even with a forged IPC file in the runner workspace.
- Eligibility → only Bash/RunCommand + non-gantry MCP reach the classifier;
  gantry capability tools (request_*) never do.

Promotion (post-refine; already ships live):
- allow_persistent_rule persists a command-NAME class rule.
- Class matches varying args of the same verb, NOT other verbs.
- Scope isolation: a rule in conversation A never matches conversation B / other agent.
- Restart survival: rule persists across runtime restart (postgres projection).
- record-before-prompt: pending interaction durably recorded BEFORE the prompt shows.

Audit/security:
- Decisions emit the correct events; NO raw credential appears in any event/log.

## Granular CAPABILITY matrix (integration layer)

- Declaration → tool-rule projection (`capability:<id>` rules present/active).
- local_cli binding: pinned executablePath/version/hash + command templates
  enforced; a command outside the templates is denied.
- Fixed-image preflight: selected capability absent from image inventory →
  admission fails closed with the setup message; present → proceeds.
- Per-capability sandbox profile: protectedPaths → runner read/deny-write paths;
  networkHosts → egress allow entries.
- Credential integrity: tampered/unsupported ciphertext →
  CredentialSecretCryptoIntegrityError, capability treated unavailable
  (fail-closed), no crash.
- Capability secret lifecycle: store → retrieve → rotate → audit.
- Egress denylist: a denylisted host is blocked through the gateway;
  `egress.connect` audit emitted. (Direct-mode note: enforced on gateway-routed
  traffic; documents the cooperative-vs-jailed limit.)

## Packaged-runtime E2E proofs (thin — real image + real turn)

Adopt OpenClaw deterministic/live split + packaged-artifact testing + evidence
artifacts; Hermes isolated runtime state + credential scrubbing + behavioral
assertions + parallel slicing. Start the exact CI-built image, isolated
`GANTRY_HOME`, disposable Postgres, apply migrations, configure desired state via
supported Control API/SDK (no production test routes), restart once, exercise the
Control API agent path.

Typed `AgentE2EScenario` + `AgentE2EEvidence` under `apps/core/test/agent-e2e/`.
Evidence: scenario, commit/image digest, model alias/route, provider, harness,
run/session IDs, selected skills, MCP calls, capability decisions, audit IDs,
timings, redacted failure detail.

Scenarios (behavioral assertions — state transitions/tool traces/persisted
records/structured formats, NOT NL snapshots):
| Scenario | Proof |
|---|---|
| Runtime/model | Image starts, migrations current, Control API turn completes; evidence identifies expected alias/route/provider/family/harness. |
| Skill lifecycle | `internal-comms` (Apache-2.0, pinned `fa0fa64bdc967915dc8399e803be67759e1e62b8`) installs via `/v1/skills/install`, binds, survives restart, materializes all assets incl. `examples/3p-updates.md` via progressive disclosure, produces the pinned Progress/Plans/Problems 3P format. `gantry-admin` exercised separately via read-only `admin_permission_list`. |
| MCP lifecycle | `@modelcontextprotocol/server-everything@2.0.0` on loopback Streamable HTTP, registered via SDK, only `echo`+`get-sum` approved; discovery, schema, `get-sum(20,22)=42`, output validation, denied-tool invisibility, MCP audit. |
| Permission real-turn | One real turn where a RunCommand is permission-decided (auto_classifier or human-sim) and audit recorded. |
| Capability real-turn | `admin_permission_list` succeeds; a local_cli capability preflight passes / fails-closed in the real image. |
| Recovery/security | Skill+MCP selections survive restart; transient authority (allow_once) does NOT; logs/evidence credential-scrubbed. |

Scripts: `test:e2e:agent:policy`, `test:e2e:agent:hermetic`, `test:e2e:agent:live`,
plus wire `test:integration:postgres` into CI.

## Live model matrix (label-gated only)

| Alias | Harness | Proof |
|---|---|---|
| `haiku` | `anthropic_sdk` | Agent response, selected skill, Gantry tool, audit evidence |
| `gpt-mini` | `deepagents` | Agent response, selected skill, MCP proxy call, audit evidence |

Semantic base/head catalog diff adds: newly-introduced executable aliases; models
whose provider route/credential mode changed; models whose response family/harness
compatibility changed. Missing credentials FAIL (not skip) — but only on the
label-gated live lane. Use dedicated low-spend protected-environment credentials,
never production.

## Merge gate (`.github/workflows/agent-e2e.yml`)

Triggers: PR open, synchronize, reopen, label, unlabel.
- Hermetic E2E + `test:integration:postgres` run for every non-docs PR.
- Policy job classifies changed paths via the path-map; UNKNOWN → fail closed
  unless `e2e-reviewed` label present.
- Risky PRs (provider/model/skill/MCP/capability/runtime change) fail until
  `live-agent-e2e` labeled; the label starts the protected-environment live job
  against the exact previously-built image digest.
- `agent-e2e-gate` aggregates all results and is the required branch-protection
  check.

## Failure & evidence policy
- Hermetic failures NOT retried. Live 429/5xx/timeout/transport retried once;
  a retry-pass reports `FLAKY` and STILL blocks merge.
- Success AND failure upload redacted JSON evidence + audit/event extracts +
  container logs + timings + a targeted rerun command.
- Required checks target 15 min (warm caches, parallel slices); live lane best-effort.

## Surface Impact Matrix

| Surface | Classification | Reason |
|---|---|---|
| Runtime behavior | Read-only/observable | Existing packaged runtime exercised; no production test branch added. |
| `settings.yaml` | Read-only/observable | Isolated desired-state ops; verify synchronized output. |
| Postgres/runtime projection | Read-only/observable | Disposable rows verify revisions, bindings, restart projection, transient expiry. |
| Control API | Read-only/observable | Existing session/skill/MCP/credential/agent/event endpoints exercised. |
| SDK/contracts | Unchanged by design | Existing clients reused; new types test-internal. |
| CLI | Unchanged by design | SDK/API setup supports HTTP MCP; no CLI feature added. |
| Gantry MCP/admin skill | Read-only/observable | Bundled skill + governed MCP facade exercised without changing authority. |
| Channel/provider adapters | Providers observable; channels deferred | Both harnesses tested; channel UI/approval rendering out of gate. |
| Docs/prompts | Changed | This goal prompt + CI/scenario/evidence docs. |
| Audit/events | Read-only/observable | Existing events become assertions/evidence. |
| Tests/verification | Changed | Runner, fixtures, packaged-runtime tests, granular integration matrix, live matrix, policy classifier, aggregator, i-have-adhd guard test. |
| Deployment workflows | Deferred | Pre-merge CI confidence is the scope; deploy automation + real TG/Slack canaries excluded. |

## Acceptance criteria
- All existing unit/integration/postgres/e2e suites remain green.
- `test:integration:postgres` runs in CI and gates.
- Hermetic agent E2E passes with NO internet or model credentials.
- Granular permission matrix (every mode + path) and capability matrix (every
  lifecycle stage) pass at the integration layer.
- Risky PRs cannot merge without `live-agent-e2e` + passing live matrix; UNKNOWN
  path changes fail closed unless `e2e-reviewed`.
- Changed provider/model routes get their own live smoke.
- `i-have-adhd` has zero references in E2E fixtures/manifests/prompts/snapshots/
  assertions (guard test enforces).

## Non-goals
- Deploy automation; real Telegram/Slack canaries.
- Rebuilding granular logic already unit/integration-tested.
- Production credentials in CI.
