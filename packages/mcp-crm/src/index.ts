import { applyMigrations } from './db/migrate.js';
import { loadRuntimeEnv } from './dotenv-load.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { startHttpServer } from './server.js';
import { startDigestWatcher } from './watcher/index.js';
import { createAnthropicExtractorLlm } from './extractor/llm-client.js';
import { bootstrapOneCliCredentials } from './onecli-bootstrap.js';

// Public surface (also used by tests / the migrate + smoke scripts).
export { loadEnv } from './env.js';
export type { BoondiCrmEnv } from './env.js';
export { startHttpServer } from './server.js';
export { createPool } from './db/pool.js';
export { RecordsRepository } from './db/records-repository.js';
export type { BusinessRecord, RecordInput } from './db/types.js';
export { scoreLead, bandForScore } from './scoring.js';
export { registerAllTools, REGISTERED_TOOL_NAMES } from './tools/index.js';
export { createLogger } from './logger.js';
export {
  IDENTITY_HEADER_NAME,
  computeIdentitySignature,
  verifyIdentityHeader,
} from './identity/identity-header.js';

const isEntry =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/mcp-crm/dist/index.js') ||
    process.argv[1].endsWith('packages/mcp-crm/src/index.ts'));

if (isEntry) {
  void (async () => {
    loadRuntimeEnv();
    // Project the model credential from the OneCLI broker the same way Gantry core
    // does — sets CLAUDE_CODE_OAUTH_TOKEN + proxy + CA into this process's env. The
    // extractor hands these to the Agent SDK's query() (which spawns the Claude
    // CLI); the connector process makes no outbound model HTTPS itself, so no
    // re-exec is needed.
    await bootstrapOneCliCredentials((msg, extra) =>
      console.error(
        JSON.stringify({ level: 'info', service: 'mcp-crm', msg, ...(extra ?? {}) }),
      ),
    );
    const env = loadEnv();
    const logger = createLogger({
      level: env.logLevel,
      format: env.logFormat,
      context: { service: 'mcp-crm' },
    });

    // Always apply our own (idempotent) migrations on boot, then start. The
    // operator just runs the server with .env; no manual migrate step.
    applyMigrations({
      databaseUrl: env.databaseUrl,
      schema: env.dbSchema,
      // One-time: move any pre-existing rows out of Gantry's schema into ours on the
      // first boot after the schema flip (no-op once dbSchema === gantrySchema again).
      gantrySchema: env.gantrySchema,
      logger,
    })
      .then(() => startHttpServer({ env, logger }))
      .then(
        (running) => {
          // Digest watcher: LLM extraction from session-end digests.
          // Started here so it shares the same pool/lifecycle.
          const stopWatcher = startDigestWatcher({
            env,
            logger,
            pool: running.pool,
            repo: running.repo,
            llm: createAnthropicExtractorLlm(env),
          });

          let shuttingDown = false;
          const shutdown = async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            stopWatcher();
            await running.close().catch(() => undefined);
            await running.pool.end().catch(() => undefined);
            process.exit(0);
          };
          process.on('SIGINT', shutdown);
          process.on('SIGTERM', shutdown);
        },
        (err) => {
          logger.fatal(
            { err: err instanceof Error ? err.message : String(err) },
            'boondi_crm_failed_to_start',
          );
          process.exit(1);
        },
      );
  })();
}
