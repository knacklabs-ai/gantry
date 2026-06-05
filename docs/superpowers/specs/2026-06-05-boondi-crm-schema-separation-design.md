# boondi-crm schema separation — design

**Date:** 2026-06-05
**Status:** approved (design questions answered)

## Goal

Give the boondi-crm MCP connector its **own Postgres schema (`boondi_crm`)** that it
owns end-to-end, fully separated from Gantry's `gantry` schema. The CRM is a distinct
service identity (separate process, network port, auth) and should have a matching
database identity. **Net user-visible behavior is unchanged** — lead capture, the
reconciler, and the admin dashboard all keep working.

## Non-goals

- Not moving to a separate physical **database** — the reconciler legitimately reads
  Gantry's chat transcript (`messages`, `conversations`, `message_parts`), and
  Postgres can't cross-database join. Same DB, separate schema + role is the boundary.
- Not changing the CRM's tool surface, scoring, or reconciler logic.

## Current state (the coupling)

- The CRM owns two tables, today created in the **`gantry`** schema (default of
  `BOONDI_CRM_DB_SCHEMA`): `boondi_business_records` (leads/queries) and
  `boondi_reconcile_cursor` (reconciler idempotency cursor).
- `migrate.ts` only does `SET search_path TO <schema>` then runs the SQL — it does
  **not** create the schema. Works today only because core pre-creates `gantry`.
- The reconciler (`reconciler/gantry-source.ts`) reads Gantry's `messages`,
  `conversations`, `message_parts` with **unqualified** names (resolved via
  search_path) — a one-way, read-only dependency.
- `BOONDI_CRM_DATABASE_URL` falls back to `GANTRY_DATABASE_URL` when unset.
- The **admin dashboard** (`boondi-admin/lib/queries.ts`) hardcodes
  `FROM gantry.boondi_business_records` in two places.

## Design

### Schema ownership
- The CRM's two tables move to **`boondi_crm`** (new default of `BOONDI_CRM_DB_SCHEMA`).
- `migrate.ts` runs **`CREATE SCHEMA IF NOT EXISTS <schema>`** before `SET search_path`
  — so a brand-new/empty DB creates the schema + tables with zero errors. Idempotent.

### Identity (decision #1: full)
- **Remove the `GANTRY_DATABASE_URL` fallback.** If `BOONDI_CRM_DATABASE_URL` is not
  set, the connector throws a clear startup error. The CRM requires its own connection.
- Ship a **least-privilege role SQL** (doc, for the operator to apply): a `boondi_crm`
  role with `ALL` on the `boondi_crm` schema and `SELECT`-only on Gantry's three
  transcript tables (`messages`, `conversations`, `message_parts`) — nothing else.

### Reconciler cross-schema reads
- The CRM's runtime connection uses `search_path = boondi_crm` (purely its own).
- The reconciler's transcript reads become **explicit**: `FROM <gantry_schema>.messages`
  etc., where the gantry schema name comes from a new `BOONDI_CRM_GANTRY_SCHEMA`
  setting (default `gantry`). The cursor stays unqualified → `boondi_crm`.

### Existing-data migration (decision #2: copy + drop)
- A guarded, idempotent step copies existing rows from `<gantry>.boondi_business_records`
  and `<gantry>.boondi_reconcile_cursor` into `boondi_crm` (`ON CONFLICT DO NOTHING`),
  then **drops** the old gantry tables. Guarded by `to_regclass(...) IS NOT NULL`, so it
  is a **no-op on an empty DB** and idempotent on re-run (after the drop, the guard
  skips). Atomic (single statement batch → one implicit transaction).
- Uses the configured schema names (not hardcoded), so it's robust to renamed schemas.

### Dashboard
- Update the two `boondi-admin/lib/queries.ts` reads to
  `FROM boondi_crm.boondi_business_records`.

## Edge cases (explicit)

| Case | Behavior |
|------|----------|
| Empty / brand-new DB | `CREATE SCHEMA IF NOT EXISTS` + create tables; data-copy is a no-op (old tables don't exist). No errors. |
| Existing DB with data | schema created, tables created, rows copied, old gantry tables dropped. |
| Re-run on every boot | idempotent: `IF NOT EXISTS` tables, `to_regclass` guard skips the already-done copy/drop. |
| `BOONDI_CRM_DATABASE_URL` unset | clear startup error (no silent fallback). |
| Renamed schemas | configured names used everywhere (no hardcoded `gantry`/`boondi_crm` in logic). |
| Deploy ordering | dashboard + connector updated together; the drop happens at connector migrate time. Single-operator restart covers this. |

## Testing (TDD)

- **migrate (unit/integration on a fresh schema):** empty DB → schema + both tables
  created, no error; idempotent re-run; data-copy moves rows once and drops old tables;
  copy is a no-op when old tables absent.
- **env:** default schema is `boondi_crm`; missing `BOONDI_CRM_DATABASE_URL` throws.
- **reconciler:** transcript reads are qualified with the configured gantry schema;
  the cursor read/write targets `boondi_crm`.
- **end-to-end on a fresh `boondi_crm`:** `record_query → upgrade_to_lead → reconciler
  reconstruct → dashboard SELECT` all succeed.

## Files to change

- `packages/mcp-crm/src/db/migrate.ts` — `CREATE SCHEMA IF NOT EXISTS`; data-copy+drop.
- `packages/mcp-crm/src/env.ts` — default schema `boondi_crm`; require URL (no fallback);
  add `BOONDI_CRM_GANTRY_SCHEMA` (default `gantry`).
- `packages/mcp-crm/src/db/pool.ts` — `search_path = boondi_crm`.
- `packages/mcp-crm/src/reconciler/gantry-source.ts` — qualify gantry reads.
- `packages/mcp-crm/migrations/000X_migrate_from_gantry.sql` (or code step) — the copy+drop.
- `boondi-admin/lib/queries.ts` (+ `lib/types.ts` comment) — read `boondi_crm.*`.
- Docs: the scoped-role SQL snippet.
- Tests: `packages/mcp-crm/test/migrate.test.ts` and new cases.
