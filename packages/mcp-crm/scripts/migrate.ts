// Applies boondi-crm's own SQL migrations to the configured schema on demand:
//   npm run migrate   (from packages/mcp-crm)
// The server also runs these automatically on boot (src/index.ts); this script
// is for running them standalone (CI, manual ops). The actual runner lives in
// src/db/migrate.ts so both paths share one idempotent implementation.
import { applyMigrations } from '../src/db/migrate.js';
import { loadRuntimeEnv } from '../src/dotenv-load.js';

loadRuntimeEnv();

const databaseUrl =
  process.env.BOONDI_CRM_DATABASE_URL ?? process.env.GANTRY_DATABASE_URL;
const schema = process.env.BOONDI_CRM_DB_SCHEMA ?? 'gantry';

if (!databaseUrl) {
  process.stderr.write(
    'Missing BOONDI_CRM_DATABASE_URL (or GANTRY_DATABASE_URL)\n',
  );
  process.exit(1);
}

try {
  const { applied } = await applyMigrations({ databaseUrl, schema });
  process.stdout.write(
    `boondi-crm: applied ${applied.length} migration(s) to schema "${schema.trim() || 'gantry'}"\n`,
  );
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
