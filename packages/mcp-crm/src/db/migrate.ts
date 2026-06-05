import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/i;

export interface ApplyMigrationsInput {
  databaseUrl: string;
  schema: string;
  // The legacy schema to migrate existing rows FROM (Gantry's, default `gantry`).
  // Defaults to `schema` itself, which makes the one-time copy+drop a safe no-op —
  // it only runs when a DIFFERENT source schema is explicitly provided.
  gantrySchema?: string;
  logger?: { info: (data: Record<string, unknown>, message: string) => void };
}

export interface ApplyMigrationsResult {
  applied: string[];
}

function migrationsDir(): string {
  // src/db/migrate.ts -> ../../migrations; dist/db/migrate.js -> ../../migrations
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'migrations',
  );
}

// The CRM-owned tables, with their conflict key, for the one-time legacy move.
const OWNED_TABLES: ReadonlyArray<{ table: string; pk: string }> = [
  { table: 'boondi_business_records', pk: 'id' },
  { table: 'boondi_reconcile_cursor', pk: 'conversation_id' },
];

// One-time, idempotent migration of pre-existing rows from the legacy (gantry) schema
// into the CRM's own schema, then DROP the old tables. Guarded by to_regclass, so it is
// a clean no-op on a fresh DB and on every subsequent boot (after the drop). The caller
// only invokes this when `schema !== gantrySchema`; both names are SCHEMA_PATTERN-checked.
async function migrateFromLegacySchema(
  client: pg.Client,
  schema: string,
  gantrySchema: string,
  logger?: ApplyMigrationsInput['logger'],
): Promise<void> {
  for (const { table, pk } of OWNED_TABLES) {
    const reg = await client.query<{ r: string | null }>(
      'SELECT to_regclass($1) AS r',
      [`${gantrySchema}.${table}`],
    );
    if (!reg.rows[0]?.r) continue; // absent → nothing to migrate
    await client.query(
      `INSERT INTO ${schema}.${table} SELECT * FROM ${gantrySchema}.${table} ON CONFLICT (${pk}) DO NOTHING`,
    );
    await client.query(`DROP TABLE ${gantrySchema}.${table}`);
    logger?.info(
      { table, from: gantrySchema, to: schema },
      'boondi_crm_legacy_rows_migrated',
    );
  }
}

// Applies boondi-crm's own SQL migrations to the configured schema. Idempotent
// (the SQL is CREATE ... IF NOT EXISTS / harmless GRANTs), so it is safe to run
// on every boot. Kept separate from Gantry core's migration runner to preserve
// the neutral-engine boundary — these tables are Boondi-owned.
export async function applyMigrations(
  input: ApplyMigrationsInput,
): Promise<ApplyMigrationsResult> {
  if (!input.databaseUrl) {
    throw new Error('applyMigrations: databaseUrl is required');
  }
  const schema = (input.schema ?? 'gantry').trim() || 'gantry';
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new Error(`Refusing unsafe schema name: ${schema}`);
  }
  // Default the legacy source to `schema` itself so the destructive copy+drop is a
  // no-op unless a DIFFERENT source schema is explicitly provided.
  const gantrySchema = (input.gantrySchema ?? schema).trim() || schema;
  if (!SCHEMA_PATTERN.test(gantrySchema)) {
    throw new Error(`Refusing unsafe schema name: ${gantrySchema}`);
  }
  const dir = migrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = new pg.Client({ connectionString: input.databaseUrl });
  await client.connect();
  try {
    // The CRM owns its schema end-to-end: on a brand-new/empty DB the schema does
    // not pre-exist (unlike `gantry`, which core creates), so create it first. The
    // name is validated by SCHEMA_PATTERN above, so interpolation is injection-safe.
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query(sql);
    }
    if (schema !== gantrySchema) {
      await migrateFromLegacySchema(client, schema, gantrySchema, input.logger);
    }
  } finally {
    await client.end();
  }
  input.logger?.info(
    { schema, count: files.length },
    'boondi_crm_migrations_applied',
  );
  return { applied: files };
}
