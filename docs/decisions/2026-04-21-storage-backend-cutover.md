# 2026-04-21 — App-Wide Storage Backend Cutover

## Context

MyClaw runtime persistence and memory persistence were SQLite-specific and implemented through raw SQL modules. Public settings/docs still mixed runtime storage and memory semantics, and historical provider-era terms (`qmd`, `memory.provider`, `memory.sqlite_path`, `memory.qmd_root`) remained in active guidance.

We need a single cut to:
- keep runtime storage configuration under `storage.*`
- keep memory settings under `memory.*` with a dedicated memory DB path derived from `memory.root`
- remove QMD/provider-era interfaces and compatibility paths

## Decision

1. Runtime storage settings are configured in `settings.yaml` under `storage.*`:
   - `storage.provider` (`sqlite` in host runtime)
   - `storage.sqlite.path`
2. Memory settings remain storage-neutral under `memory.*`.
3. QMD provider semantics are removed from active code/docs/CLI/skills.
4. Deprecated interfaces are removed with no fallback aliases:
   - `memory.provider`
   - `memory.sqlite_path`
   - `memory.qmd_root`
   - `myclaw memory provider <...>`
5. Existing runtime memory SQLite artifacts are intentionally reset at cutover; no import/migration path is provided for old `~/myclaw/memory/.cache/memory.db`.

## Alternatives Considered

- Keep SQLite-only runtime:
  accepted for host runtime in this cut.
- Add temporary compatibility shims for removed memory provider keys:
  rejected due complexity and policy preference for clean cutovers in early-stage code.
- Auto-migrate previous memory DB into new schema:
  rejected; acceptable live impact and lower operational risk than one-off migration code.

## Consequences

- Runtime state continues on SQLite in host runtime (`storage.sqlite.path`).
- Memory database path is separate and derived from `memory.root` (`memory/.cache/memory.db` by default).
- Existing local memory content must be manually re-saved when needed after cutover.
- Health/diagnostics report runtime storage provider and memory DB path explicitly.

## Rollback Or Migration Notes

- Rollback means restoring an earlier build and restoring old runtime storage files manually from backup.
- Product code does not include previous-schema DB import, compatibility readers, or automatic migration routines.

## Supersedes

- Clarifies and extends [2026-04-17 — Settings And Runtime Truth](./2026-04-17-settings-runtime-truth.md) for storage backend selection and provider-era interface removal.
