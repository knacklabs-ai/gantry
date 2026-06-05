# MCP ↔ Core Credential Decoupling

- **Date:** 2026-06-04
- **Status:** Approved design (pending spec review → implementation plan)
- **Owner:** Samad (Boondi)

## 1. Problem

Bringing Boondi up on a brand-new database surfaced hidden coupling between the
Gantry **core** runtime and the **HTTP MCP connectors** (`boondi-crm` :8082,
`shopify-api` :8081):

1. Core refuses to spawn the agent until `BOONDI_CRM_DATABASE_URL` (and the
   Shopify `SHOPIFY_PROD_*` creds) exist in the Postgres **capability secret
   store** — even though, for an HTTP connector, core never uses those values.
   The connector already reads them from its own `.env`.
2. The connector's own tables (`boondi_business_records`,
   `boondi_reconcile_cursor`) require a **manual** `npm run migrate`.

The operator wants a single, simple workflow: **start each connector with
`~/gantry/.env`, start core, done.** No `gantry secrets import-env`, no manual
migration. The MCP connectors are independent HTTP services and should be
treated as such by core.

## 2. Principle

> The capability **secret store/broker governs only credentials core injects
> into processes it spawns** (stdio MCP servers). **External HTTP/SSE connectors
> are independent**: they own their configuration via their own runtime `.env`.
> Core's *only* coupling to them is (a) the loopback URL and (b) the **shared
> caller-identity signing secret**, which core reads from its **runtime
> `$GANTRY_HOME/.env`** — never the store.

This keeps the broker contract meaningful where it matters (spawned servers,
where core controls the environment) while making first-party loopback
connectors fully self-contained.

## 3. Exhaustive core ↔ connector secret inventory

The operator's explicit concern: *do not forget a secret shared between core and
the MCPs.* Full enumeration:

| Secret | Core needs it? | Connector needs it? | Shared boundary? | Source after this change |
|---|---|---|---|---|
| `MCP_IDENTITY_SECRET` (caller-identity HMAC signing) | **Yes** — signs `X-Caller-Identity` | **Yes** — verifies it (both `boondi-crm` + `shopify-api`) | **★ the ONE shared secret** | core: `$GANTRY_HOME/.env`; connector: its own `.env` |
| `BOONDI_CRM_DATABASE_URL`, `BOONDI_CRM_DB_SCHEMA` | No (unused for HTTP) | Yes — its Postgres | connector-only | connector `.env` |
| `SHOPIFY_PROD_SHOP_DOMAIN` / `SHOPIFY_PROD_CLIENT_ID` / `SHOPIFY_PROD_CLIENT_SECRET` | No (unused for HTTP) | Yes — Shopify Admin API (`TokenManager`) | connector-only | connector `.env` |

**Conclusion:** exactly **one** secret crosses the boundary — the caller-identity
signing secret. Both connectors run in `caller_identity.mode: required`
([mcp-crm server.ts](../../../packages/mcp-crm/src/server.ts), [shopify server.ts](../../../packages/mcp-shopify/src/server.ts)),
so a wrong/absent signing secret means **every** tool call is rejected. This is
the secret the design must guarantee end-to-end.

**Critical mechanism note:** core does **not** hydrate `~/gantry/.env` into
`process.env`; it reads runtime secrets via its own loader
([config/env/index.ts](../../../apps/core/src/config/env/index.ts)). Reading the
signing secret therefore goes through `runtimeEnvValueDynamic(name)` (which is
`process.env[name] || readEnvFile($GANTRY_HOME/.env)[name]`), **not** raw
`process.env` — otherwise it is silently empty and identity verification fails.

## 4. Changes

### C1 — Core ignores connectors' `credential_refs` for HTTP/SSE
[`apps/core/src/application/mcp/mcp-server-materialization.ts`](../../../apps/core/src/application/mcp/mcp-server-materialization.ts)

`materializeMcpRecord` currently resolves **all** `credentialRefs` up front and
throws on any missing value, before branching on transport. For `http`/`sse`
transports, core cannot inject env into a remote process, so `target: 'env'`
refs are resolved-but-unused. Change: for `http`/`sse`, only require/resolve
`target: 'header'` refs; drop `target: 'env'` refs (optionally debug-log them as
connector-owned). `stdio` behavior is unchanged (still resolves all refs).

Effect: `BOONDI_CRM_DATABASE_URL` and `SHOPIFY_PROD_*` are no longer required in
the store.

### C2 — Core resolves the caller-identity `signing_ref` from runtime `.env`
[`apps/core/src/application/capability-secrets/mcp-secret-projection.ts`](../../../apps/core/src/application/capability-secrets/mcp-secret-projection.ts)

`resolveMcpCredentialEnvForAgent` currently resolves both `credentialRefs` and
the `signing_ref` from the secret store. Change: for `http`/`sse` connectors,
resolve the `signing_ref` via an injected runtime-env reader (default
`runtimeEnvValueDynamic`) instead of the store, and stop pulling
`credentialRefs` (made unnecessary by C1). `stdio` connectors keep store-based
resolution. The reader is a constructor/param dependency so tests can inject a
fake env map.

Effect: for `http`/`sse`, the resolved `credentialEnv` carries the signing
secret from `~/gantry/.env`; the existing spawn-time signer consumes
`credentialEnv[signingRef]` unchanged. **Core needs zero secret-store entries
for `boondi-crm` / `shopify-api`.**

### C3 — boondi-crm auto-migrates on boot (always on)
[`packages/mcp-crm/src/index.ts`](../../../packages/mcp-crm/src/index.ts), new `packages/mcp-crm/src/db/migrate.ts`

Extract the migration runner out of `scripts/migrate.ts` into a reusable
`applyMigrations({ databaseUrl, schema, logger })` (idempotent — the SQL is
`CREATE TABLE IF NOT EXISTS`). Call it during server boot, **before** `listen`,
logging `boondi_crm_migrations_applied`. `scripts/migrate.ts` becomes a thin
wrapper over the same function (so `npm run migrate` still works). Always-on per
operator decision (no opt-out flag). Shopify has no tables/migrations → not
applicable there.

### C4 — Update the written contract
[`AGENTS.md`](../../../AGENTS.md) (and `docs/architecture/capability-management.md` if it states the rule)

The repo contract currently says agent-accessed tool credentials must go through
the broker, "not raw runtime env." Amend it to state the boundary from §2:
broker governs spawned (stdio) servers; external HTTP/SSE connectors are
independent and read their own credentials from runtime env, and core reads only
the shared caller-identity signing secret from `$GANTRY_HOME/.env`. The contract
must describe reality, not contradict it.

### C5 — Strip dead `credential_refs` from `settings.yaml`
`~/gantry/settings.yaml` (runtime), plus any repo settings template carrying the
same blocks.

Once C1 lands, the HTTP connectors' `credential_refs` are dead config. Verified
safe to remove: the parser defaults the field to `[]` when absent
([runtime-settings-mcp-parser.ts:203](../../../apps/core/src/config/settings/runtime-settings-mcp-parser.ts);
`parseMcpCredentialRefs(undefined) → []`), desired-state validation accepts an
empty list, and the "stdio_template env must use credentialRefs" rule
([runtime-settings-mcp-desired-state.ts:87](../../../apps/core/src/config/settings/runtime-settings-mcp-desired-state.ts))
applies only to `stdio_template` servers — not these `http` ones. Action: delete
the `credential_refs:` line from both `mcp:boondi-crm` and `mcp:shopify-api`.
**Keep** `caller_identity` (required by the design). Removal triggers a normal,
non-destructive desired-state re-version on next boot. Scope strictly to the
now-dead `credential_refs` — do **not** touch other config unless it is provably
unused (operator directive: *remove env config only if not required*).

### C6 — Strict dead-code sweep
After C1–C5 land, remove every code path the change leaves unreachable, each
confirmed by a zero-reference ripgrep before deletion:
- the inline migration logic in `scripts/migrate.ts`, superseded by the shared
  `applyMigrations`;
- any materialization/projection branch or helper that existed only to resolve
  `env`-target `credential_refs` for http/sse, if now unreferenced;
- now-orphaned imports/exports in the touched files.
No commented-out or orphaned code is left behind. A final review pass (the
`code-review` / `pr-review-toolkit:code-reviewer` tooling) gates completion on
"no dead code, no dead config."

## 5. Fail-fast guard (addresses "don't forget the shared secret")

Because the signing secret is now the single point of coupling, a missing value
should be **loud, not silent**. When core materializes an `http`/`sse` connector
in `caller_identity.mode: required` and the `signing_ref` resolves empty from
runtime env, log a clear `error` (e.g. `mcp_signing_secret_missing_from_env`
naming the connector and the env key) at materialization time, rather than
letting every downstream tool call fail an opaque signature check. (We do not
hard-crash the runtime; one connector's missing secret should not take down
the agent for other capabilities — consistent with the existing
non-required/required materialization handling.)

## 6. Out of scope / non-goals

- No change to **stdio** MCP credential flow (still store/broker).
- The secret store is **not** removed; it remains for spawned servers.
- No change to the identity signing **algorithm** or the `X-Caller-Identity`
  format.
- No change to connector-side env reading (they already read their own `.env`).
- No broad `settings.yaml` rewrite: C5 strips only the now-dead
  `credential_refs` from the two HTTP connectors; all other config is left
  intact unless provably unused.

## 7. Testing strategy (TDD-first)

**Unit (write failing tests first):**
- *Materialization (C1):* an `http` server whose `credentialRefs` are all
  `target: 'env'`, with an **empty** `credentialEnv`, materializes successfully
  (no throw) and injects no env; a `header`-target ref on `http` is still
  required; a `stdio` server still requires all refs (regression guard).
- *Projection (C2):* for `http`/`sse`, the `signing_ref` is resolved from the
  injected runtime-env reader and the secret store is **not** consulted for it;
  for `stdio`, the store is still used. Missing signing secret → the fail-fast
  guard (§5) fires.
- *Migration (C3):* `applyMigrations` creates `boondi_business_records` +
  `boondi_reconcile_cursor`; a second call is a no-op (idempotent); server boot
  invokes it.
- *Settings parse (C5):* an MCP server block **without** `credential_refs`
  parses to `credentialRefs: []` and reconciles to desired state without error
  (guards the yaml cleanup).

**Cleanup verification (C6):** ripgrep shows zero references to anything deleted;
`npm run build` / `typecheck` / `lint` pass with no unused-symbol warnings in the
touched files; the review pass reports no dead code or dead config.

**End-to-end (operator's explicit ask — "core can connect to both servers"):**
With a **fresh DB** and **no secret-store entries**, start core + `boondi-crm` +
`shopify-api`, each loaded only from `~/gantry/.env`. Drive one agent turn that
calls each connector and assert:
1. Core materializes **both** connectors with **no** missing-secret error.
2. Each connector **accepts** the signed `X-Caller-Identity` header (identity
   verified, not `BAD_SIGNATURE`).
3. A `boondi-crm` write tool call succeeds (record lands in
   `boondi_business_records`).
4. A `shopify-api` read tool call succeeds (e.g. a `lookup_*`/`get_*`).

Build on the existing harness where practical
([scripts/capture-preflight.sh](../../../scripts/capture-preflight.sh) brings up
:8081/:8082; [scripts/interakt-test-run.mjs](../../../scripts/interakt-test-run.mjs)
drives turns), or a focused integration test that exercises the same path.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Signing secret now sourced from runtime env, not broker (contract deviation) | Documented boundary (C4); broker still governs stdio; `requireVerifiedIdentity` stays on; first-party loopback only |
| Signing secret absent from `$GANTRY_HOME/.env` → silent auth failures | Fail-fast guard (§5) logs a precise error at materialization |
| Existing deployments that put these in the store | Store entries for HTTP connectors become unused (harmless); signing must be present in runtime env — call out in C4/docs |
| Auto-migrate runs on every boot | Idempotent (`IF NOT EXISTS`); cheap; matches operator's "always on" |

## 9. Files touched (summary)

- `apps/core/src/application/mcp/mcp-server-materialization.ts` (C1)
- `apps/core/src/application/capability-secrets/mcp-secret-projection.ts` (C2)
- `packages/mcp-crm/src/index.ts`, new `packages/mcp-crm/src/db/migrate.ts`, `packages/mcp-crm/scripts/migrate.ts` (C3)
- `AGENTS.md` / `docs/architecture/capability-management.md` (C4)
- `~/gantry/settings.yaml` — strip dead `credential_refs` from both HTTP connectors (C5)
- Dead-code sweep across all touched files + `scripts/migrate.ts` (C6)
- Tests: core unit (materialization, projection, settings-parse), mcp-crm unit (migrate), one E2E (core ↔ both connectors)
