import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { applyMigrations } from '../src/db/migrate.js';

// Real migration run against the local Postgres in a throwaway schema. Skips
// cleanly when no database URL is configured (e.g. CI without a DB).
const DATABASE_URL =
  process.env.BOONDI_CRM_DATABASE_URL ?? process.env.GANTRY_DATABASE_URL;
const TEST_SCHEMA = 'boondi_crm_migrate_test';

const describeMaybe = DATABASE_URL ? describe : describe.skip;

describeMaybe('applyMigrations (live Postgres)', () => {
  let client: pg.Client;

  async function tableExists(name: string): Promise<boolean> {
    const res = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [
      `${TEST_SCHEMA}.${name}`,
    ]);
    return res.rows[0].ok === true;
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await client.end();
  });

  it('creates the boondi tables in the target schema', async () => {
    const result = await applyMigrations({
      databaseUrl: DATABASE_URL!,
      schema: TEST_SCHEMA,
    });
    expect(result.applied.length).toBeGreaterThan(0);
    expect(await tableExists('boondi_business_records')).toBe(true);
    expect(await tableExists('boondi_reconcile_cursor')).toBe(true);
  });

  it('is idempotent — a second run does not throw', async () => {
    await expect(
      applyMigrations({ databaseUrl: DATABASE_URL!, schema: TEST_SCHEMA }),
    ).resolves.toMatchObject({ applied: expect.any(Array) });
    expect(await tableExists('boondi_business_records')).toBe(true);
  });

  it('re-running with MANY open opportunities per phone neither throws nor truncates', async () => {
    // The empty-table idempotency test above can't catch the two migration bugs
    // that only surface with real per-opportunity data: 0001 re-creating the
    // single-open-per-phone UNIQUE index (fails on >1 open/phone), and 0002's
    // every-boot TRUNCATE (wipes real rows). Seed two open opps for one phone,
    // then re-apply: must neither throw nor delete the rows.
    const schema = 'boondi_crm_reapply_data_test';
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    try {
      await applyMigrations({ databaseUrl: DATABASE_URL!, schema });
      await client.query(
        `INSERT INTO ${schema}.boondi_business_records (id, phone, status, source)
           VALUES ('o1','910000000001','query','extractor'),
                  ('o2','910000000001','lead','extractor')`,
      );
      await expect(
        applyMigrations({ databaseUrl: DATABASE_URL!, schema }),
      ).resolves.toBeDefined();
      const cnt = await client.query(
        `SELECT count(*)::int AS n FROM ${schema}.boondi_business_records WHERE phone='910000000001'`,
      );
      expect(cnt.rows[0].n).toBe(2); // preserved across re-apply, not truncated
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  });

  it('rejects an unsafe schema name', async () => {
    await expect(
      applyMigrations({ databaseUrl: DATABASE_URL!, schema: 'bad;name' }),
    ).rejects.toThrow(/unsafe schema/i);
  });

  it('copies rows from the legacy gantry schema, then drops the old tables', async () => {
    const legacy = 'boondi_crm_legacy_src_test';
    const target = 'boondi_crm_legacy_dst_test';
    await client.query(`DROP SCHEMA IF EXISTS ${legacy} CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS ${target} CASCADE`);
    try {
      // Seed a "legacy" schema with the tables + a row (gantrySchema=itself => no copy).
      await applyMigrations({
        databaseUrl: DATABASE_URL!,
        schema: legacy,
        gantrySchema: legacy,
      });
      await client.query(
        `INSERT INTO ${legacy}.boondi_business_records (id, phone) VALUES ('rec1','919900099999')`,
      );

      // Migrate into a fresh target, copying from the legacy schema.
      await applyMigrations({
        databaseUrl: DATABASE_URL!,
        schema: target,
        gantrySchema: legacy,
      });

      const moved = await client.query(
        `SELECT count(*)::int AS n FROM ${target}.boondi_business_records WHERE id='rec1'`,
      );
      expect(moved.rows[0].n).toBe(1); // row copied into the new schema

      const oldGone = await client.query('SELECT to_regclass($1) AS r', [
        `${legacy}.boondi_business_records`,
      ]);
      expect(oldGone.rows[0].r).toBeNull(); // old table dropped

      // Idempotent: a second run is a clean no-op (old table already gone).
      await expect(
        applyMigrations({
          databaseUrl: DATABASE_URL!,
          schema: target,
          gantrySchema: legacy,
        }),
      ).resolves.toBeDefined();
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${legacy} CASCADE`);
      await client.query(`DROP SCHEMA IF EXISTS ${target} CASCADE`);
    }
  });

  it('creates the target schema itself when it does not exist (empty DB)', async () => {
    // The CRM owns its schema end-to-end: on a brand-new DB the schema does NOT
    // pre-exist (unlike `gantry`, which core creates), so migrate must create it.
    const freshSchema = 'boondi_crm_migrate_empty_test';
    await client.query(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE`);
    try {
      await applyMigrations({ databaseUrl: DATABASE_URL!, schema: freshSchema });
      const res = await client.query(
        'SELECT to_regclass($1) IS NOT NULL AS ok',
        [`${freshSchema}.boondi_business_records`],
      );
      expect(res.rows[0].ok).toBe(true);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE`);
    }
  });
});
