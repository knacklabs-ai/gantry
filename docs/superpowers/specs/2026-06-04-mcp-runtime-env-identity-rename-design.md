# MCP Runtime-Env Loading + Identity-Var Rename

- **Date:** 2026-06-04
- **Status:** Approved design (proceeding to implementation plan)
- **Owner:** Samad (Boondi)

## 1. Problem

Two coupled issues with how the HTTP MCP connectors (`mcp-shopify` :8081,
`mcp-crm` :8082 — the only two MCP services) handle environment and identity:

1. **Env loading diverges from core.** Core reads the runtime env by resolving
   `getGantryHome()` (`$GANTRY_HOME`, default `~/gantry`) and reading
   `$GANTRY_HOME/.env` directly ([gantry-home.ts](../../../apps/core/src/shared/gantry-home.ts),
   [env-runtime-secret-provider.ts](../../../apps/core/src/adapters/credentials/env-runtime-secret-provider.ts)).
   The MCPs instead call `loadDotenvUpwards()`, which walks **up from
   `process.cwd()`** for the nearest `.env`. Because the runtime (`~/gantry`)
   and the repo (`~/Desktop/gantry`) are **siblings**, that search never finds
   `~/gantry/.env` — which is why [capture-preflight.sh:55,70](../../../scripts/capture-preflight.sh)
   has to hand-feed `node --env-file="$GANTRY_HOME/.env"`. The connectors should
   read the runtime folder env **by default, exactly like core**.

2. **Identity vars are mis-named as Shopify-specific.** The caller-identity HMAC
   signing secret is `SHOPIFY_MCP_IDENTITY_SECRET`, but it signs **every** MCP
   (both connectors verify with it), not just Shopify. Likewise the replay-window
   var exists as two connector-specific names (`SHOPIFY_MCP_IDENTITY_MAX_AGE_SEC`
   for shopify, `BOONDI_CRM_IDENTITY_MAX_AGE_SEC` for crm) when it is one concept
   shared by all MCPs.

## 2. Goals / Non-goals

**Goals**
- MCP connectors load `$GANTRY_HOME/.env` by default, mirroring core.
- `SHOPIFY_MCP_IDENTITY_SECRET` → `MCP_IDENTITY_SECRET`, renamed **everywhere**
  (code, scripts, docs, tests, and the runtime `~/gantry/.env` + `settings.yaml`).
- A single `MCP_IDENTITY_MAX_AGE_SEC` used by **all** MCPs; the connector-specific
  max-age names are removed.

**Non-goals**
- No change to the identity signing **algorithm** or `X-Caller-Identity` format.
- No change to the credential-decoupling boundary (see the sibling spec
  `2026-06-04-mcp-core-credential-decoupling-design.md`); this builds on it.
- Connector-specific vars stay connector-specific and are **not** renamed:
  `SHOPIFY_MCP_REQUIRE_VERIFIED_IDENTITY`, `BOONDI_CRM_REQUIRE_VERIFIED_IDENTITY`,
  `SHOPIFY_MCP_IDENTITY_CACHE_TTL_MS`, `SHOPIFY_MCP_PORT`, `BOONDI_CRM_MCP_PORT`.

## 3. Part A — MCPs read `$GANTRY_HOME/.env` (mirror core)

Replace the upward-walking loader in **each** MCP's `dotenv-load.ts` with a
runtime-home loader. Both packages keep their **own copy** (the existing
deliberate "self-contained, no cross-package import" convention — see the comment
in [mcp-crm/src/dotenv-load.ts](../../../packages/mcp-crm/src/dotenv-load.ts)).

New shape (identical in both packages):

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Resolve the Gantry runtime home exactly like core's getGantryHome:
// explicit override > $GANTRY_HOME > ~/gantry, with ~ expansion.
function resolveGantryHome(override?: string): string {
  const raw =
    override?.trim() || process.env.GANTRY_HOME?.trim() || path.join(os.homedir(), 'gantry');
  const expanded =
    raw === '~' ? os.homedir()
    : raw.startsWith('~/') || raw.startsWith('~\\') ? path.join(os.homedir(), raw.slice(2))
    : raw;
  return path.resolve(expanded);
}

// Loads <gantryHome>/.env into process.env without overwriting already-set
// keys (so real process.env and node --env-file still win). Returns the path
// applied, or null if absent. Mirrors core's runtime-env read.
export function loadRuntimeEnv(homeOverride?: string): string | null {
  const envPath = path.join(resolveGantryHome(homeOverride), '.env');
  if (!fs.existsSync(envPath)) return null;
  applyEnvFile(envPath); // unchanged: skip comments, parse KEY=VALUE, strip quotes, no overwrite
  return envPath;
}
```

`applyEnvFile` is carried over verbatim (same comment/quote/no-overwrite rules).

**Why no directory walk / no fallback:** matches core precisely and removes the
cwd ambiguity that caused the bug. `process.env` (and `--env-file`) still take
precedence over file values, and an absent file is a no-op — `loadEnv()` then
fail-fasts on any genuinely-missing required var, identical to today.

**Call sites updated** (rename + drop start-dir arg where passed):
- [mcp-shopify/src/index.ts](../../../packages/mcp-shopify/src/index.ts) — import, re-export, call
- [mcp-crm/src/index.ts](../../../packages/mcp-crm/src/index.ts) — import, call
- [mcp-crm/scripts/mcp-cli.ts](../../../packages/mcp-crm/scripts/mcp-cli.ts) — import, call
- [mcp-crm/scripts/migrate.ts](../../../packages/mcp-crm/scripts/migrate.ts) — import, call (drop the explicit `path.dirname(...)` arg)
- mcp-shopify integration tests (3): `token-lifecycle.test.ts`, `tools-live.test.ts`, `identity-header-live.test.ts`

**New unit test** (none exists today) in each package: write a temp dir with a
`.env`, call `loadRuntimeEnv(tmpDir)`, assert (a) values are applied, (b) a
pre-set `process.env` key is **not** overwritten, (c) absent file → `null`.

The `--env-file="$GANTRY_HOME/.env"` flags in `capture-preflight.sh` become
redundant but harmless (they set `process.env` first; the loader won't overwrite)
— left untouched to keep blast radius minimal.

## 4. Part B — Rename `SHOPIFY_MCP_IDENTITY_SECRET` → `MCP_IDENTITY_SECRET`

The secret name flows `settings.yaml signing_ref` → core resolves it from
`~/gantry/.env` → signs `X-Caller-Identity` → connector verifies. Core has **no
hardcoded reference**; it resolves whatever `signing_ref` names. So the `.env`
key, `settings.yaml signing_ref`, and the connectors' reads must move **together**.

**Repo edits:**
- [mcp-shopify/src/env.ts](../../../packages/mcp-shopify/src/env.ts) — `source.SHOPIFY_MCP_IDENTITY_SECRET` read + the require-mode error string
- [mcp-crm/src/env.ts](../../../packages/mcp-crm/src/env.ts) — read + error string + header comment (lines ~1-5)
- [mcp-crm/src/identity/identity-header.ts](../../../packages/mcp-crm/src/identity/identity-header.ts) — comment
- [scripts/e2e-mcp-from-core.ts](../../../scripts/e2e-mcp-from-core.ts) — `SIGNING_REF` const
- [scripts/rotate-shopify-credentials.sh](../../../scripts/rotate-shopify-credentials.sh) — rotated-key list
- [mcp-crm/scripts/mcp-cli.ts](../../../packages/mcp-crm/scripts/mcp-cli.ts) — `process.env` read
- [mcp-shopify/README.md](../../../packages/mcp-shopify/README.md) — all occurrences
- [.env.example](../../../.env.example) — line 107
- [docs/.../mcp-core-credential-decoupling-design.md](2026-06-04-mcp-core-credential-decoupling-design.md), [docs/.../boondi-lead-query-qualification-design.md](2026-06-04-boondi-lead-query-qualification-design.md) — references
- Tests: [mcp-shopify/test/unit/env.test.ts](../../../packages/mcp-shopify/test/unit/env.test.ts), [runtime-settings.test.ts](../../../apps/core/test/unit/config/runtime-settings.test.ts), [mcp-secret-projection.test.ts](../../../apps/core/test/unit/application/mcp-secret-projection.test.ts), [mcp-tool-proxy.test.ts](../../../apps/core/test/unit/application/mcp-tool-proxy.test.ts)

**Runtime edits (outside repo, in lockstep):**
- `~/gantry/.env` line 76 `SHOPIFY_MCP_IDENTITY_SECRET=…` → `MCP_IDENTITY_SECRET=…`; comment line 34
- `~/gantry/settings.yaml` lines 52 & 66 `signing_ref: SHOPIFY_MCP_IDENTITY_SECRET` → `MCP_IDENTITY_SECRET`

## 5. Part C — Unify max-age to `MCP_IDENTITY_MAX_AGE_SEC`

One shared replay-window var for all MCPs; remove the connector-specific names.

- shopify `SHOPIFY_MCP_IDENTITY_MAX_AGE_SEC` → `MCP_IDENTITY_MAX_AGE_SEC`
  ([mcp-shopify/src/env.ts](../../../packages/mcp-shopify/src/env.ts) `parseIdentity`)
- crm `BOONDI_CRM_IDENTITY_MAX_AGE_SEC` → `MCP_IDENTITY_MAX_AGE_SEC`
  ([mcp-crm/src/env.ts](../../../packages/mcp-crm/src/env.ts) `parseIdentity`); the crm-specific name is deleted.
- **Unified code default = 120s**, chosen to preserve current behavior: prod
  `~/gantry/.env` already sets the shopify var to 120 and crm already defaults to
  120, so nothing changes at runtime. (shopify's old code-default of 60 was
  already overridden to 120 in prod.)
- Runtime `~/gantry/.env` line 78 → `MCP_IDENTITY_MAX_AGE_SEC=120`.
- Docs: README (lines 66, 123) + `.env.example` line 109.

## 6. Rollout & safety

The `.env` key, `settings.yaml signing_ref`, and connector code must agree on the
name **simultaneously** — a mismatch makes the signing secret resolve empty and
**every tool call fails `BAD_SIGNATURE`** (the known "hiccup" failure mode). So:

1. Land all repo edits (Parts A–C) together.
2. Apply the two runtime-file edits (`~/gantry/.env`, `~/gantry/settings.yaml`).
3. Restart core + both connectors (if connectors run from `dist`, rebuild first;
   `capture-preflight.sh` runs them from source via `tsx`). Exact restart/build
   sequence is fixed in the implementation plan.

Because `GANTRY_HOME` defaults to `~/gantry`, the Part A loader reads the correct
file even where `GANTRY_HOME` is not exported to the connector process; an
exported non-default `GANTRY_HOME` (or a `--env-file`) also resolves correctly.

## 7. Testing strategy

- **Unit (new):** `loadRuntimeEnv` per package — applies `<home>/.env`, honors
  `homeOverride`, no-overwrite of existing `process.env`, absent file → `null`.
- **Unit (update, must stay green):** mcp-shopify `env.test.ts` and core
  `runtime-settings` / `mcp-secret-projection` / `mcp-tool-proxy` tests — swap to
  the new var names; behavior unchanged.
- **E2E (existing harness):** `capture-preflight.sh` brings up :8081/:8082 from
  `~/gantry/.env`; `interakt-test-run.mjs` drives a turn. Post-rename, assert
  identity is **verified** (not `BAD_SIGNATURE`) and a connector tool call
  succeeds end-to-end.
- **Sweep:** `rg 'SHOPIFY_MCP_IDENTITY_SECRET|SHOPIFY_MCP_IDENTITY_MAX_AGE_SEC|BOONDI_CRM_IDENTITY_MAX_AGE_SEC|loadDotenvUpwards'`
  returns zero hits across repo + runtime config after the change.

## 8. Files touched (summary)

- `packages/mcp-shopify/src/dotenv-load.ts`, `packages/mcp-crm/src/dotenv-load.ts` (A)
- `packages/mcp-shopify/src/index.ts`, `packages/mcp-crm/src/index.ts`, `packages/mcp-crm/scripts/mcp-cli.ts`, `packages/mcp-crm/scripts/migrate.ts` (A call sites)
- `packages/mcp-shopify/src/env.ts`, `packages/mcp-crm/src/env.ts`, `packages/mcp-crm/src/identity/identity-header.ts` (B, C)
- `scripts/e2e-mcp-from-core.ts`, `scripts/rotate-shopify-credentials.sh` (B)
- `packages/mcp-shopify/README.md`, `.env.example`, both `docs/superpowers/specs/*` siblings (B, C)
- Tests: new `loadRuntimeEnv` unit test ×2; updated mcp-shopify `env.test.ts`, core `runtime-settings` / `mcp-secret-projection` / `mcp-tool-proxy` (A, B)
- Runtime: `~/gantry/.env`, `~/gantry/settings.yaml` (B, C) + service restart
