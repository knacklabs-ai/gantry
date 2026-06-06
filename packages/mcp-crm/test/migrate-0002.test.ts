import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, '../migrations/0002_opportunity_model.sql'),
  'utf8',
);
const sql0001 = readFileSync(
  join(here, '../migrations/0001_boondi_business_records.sql'),
  'utf8',
);

describe('migration 0002 — opportunity model (SQL content)', () => {
  it('drops the single-open-record-per-phone unique index', () => {
    expect(sql).toMatch(/DROP INDEX IF EXISTS uniq_bcr_open_per_phone/);
  });
  it('adds confidence and needs_review columns', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS confidence/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS needs_review/);
  });
  it('creates the digest cursor table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS boondi_digest_cursor/);
  });
  it('wipes legacy rows ONCE — guarded so the every-boot runner cannot re-truncate real data', () => {
    // The runner re-applies every migration on each boot. The legacy wipe must be
    // gated on the pre-redesign state (the `confidence` column not yet present), or
    // a restart would TRUNCATE real opportunities. See migrate.ts re-run contract.
    expect(sql).toMatch(/TRUNCATE TABLE boondi_business_records/);
    expect(sql).toMatch(/IF NOT EXISTS \(/);
    expect(sql).toMatch(/information_schema\.columns/);
    expect(sql).toMatch(/column_name = 'confidence'/);
  });
  it("widens the source check to allow 'extractor'", () => {
    expect(sql).toMatch(
      /CHECK \(source IN \('agent','reconciler','extractor'\)\)/,
    );
  });
});

describe('migration 0001 — base table (SQL content)', () => {
  it('does NOT (re)create the single-open-per-phone unique index', () => {
    // Removed in the per-opportunity redesign. Re-creating it every boot fails the
    // moment a phone owns >1 open opportunity, so it must be gone from 0001 (0002
    // still DROPs it for DBs that applied the pre-redesign 0001).
    expect(sql0001).not.toMatch(/CREATE UNIQUE INDEX[^;]*uniq_bcr_open_per_phone/);
  });
});
