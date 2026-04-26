import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('canonical domain cutover', () => {
  it('keeps canonical domain source free of provider/runtime imports', () => {
    const root = path.resolve('apps/core/src/domain');
    const files = fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));

    for (const file of files) {
      const filePath = path.join(file.parentPath, file.name);
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source).not.toMatch(
        /from ['"].*(adapters|runtime|control|cli|infrastructure|runner)\//,
      );
      expect(source).not.toMatch(
        /from ['"](node:|@anthropic-ai|openai|@google|@slack|grammy|playwright|dockerode)/,
      );
    }
  });

  it('records the destructive schema cutover migration', () => {
    const migration = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/schema/migrations/0008_canonical_domain_schema_cutover.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('DROP TABLE IF EXISTS registered_groups');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS apps');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS agent_channel_bindings',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS agent_runs');
  });

  it('lets canonical job updates change running job status and leases', () => {
    const opsRepo = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/schema/canonical-ops-repo.postgres.ts',
      ),
      'utf8',
    );
    const jobService = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/services/canonical-job-ops-service.ts',
      ),
      'utf8',
    );
    const jobRepository = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/repositories/canonical-job-repository.postgres.ts',
      ),
      'utf8',
    );
    const updateJobSource = jobService.slice(
      jobService.indexOf('async updateJob'),
      jobService.indexOf('async deleteJob'),
    );

    expect(opsRepo).toContain('this.jobs.updateJob');
    expect(updateJobSource).toContain(
      'const next = { ...current, ...updates }',
    );
    expect(jobRepository).toContain('.update(pgSchema.canonicalJobsPostgres)');
    expect(jobRepository).toContain('leaseRunId: record.leaseRunId');
    expect(jobRepository).toContain('leaseExpiresAt: record.leaseExpiresAt');
    expect(updateJobSource).not.toContain("existing?.status === 'running'");
  });

  it('keeps canonical runtime tables single-defined in drizzle schema', () => {
    const schema = fs.readFileSync(
      path.resolve('apps/core/src/infrastructure/postgres/schema/schema.ts'),
      'utf8',
    );

    expect(schema).not.toContain("pgTable('jobs'");
    expect(schema).not.toContain("pgTable('memory_items'");
    expect(schema).not.toContain("pgTable('memory_subjects'");
    expect(schema).not.toContain("pgTable('sessions'");
    expect(schema).not.toContain("pgTable('app_sessions'");
  });

  it('guards canonical message persistence and polling query shape', () => {
    const migration = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/schema/migrations/0008_canonical_domain_schema_cutover.sql',
      ),
      'utf8',
    );
    const opsRepo = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/schema/canonical-ops-repo.postgres.ts',
      ),
      'utf8',
    );
    const messageRepository = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/repositories/canonical-message-repository.postgres.ts',
      ),
      'utf8',
    );
    const messageService = fs.readFileSync(
      path.resolve(
        'apps/core/src/infrastructure/postgres/services/canonical-message-ops-service.ts',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'CONSTRAINT message_parts_message_id_ordinal_unique UNIQUE (message_id, ordinal)',
    );
    expect(opsRepo).toContain('this.messages.getNewMessages');
    expect(opsRepo).toContain('this.messages.getMessagesSince');
    expect(messageRepository).toContain('.onConflictDoUpdate({');
    expect(messageRepository).toContain(
      'pgSchema.messagePartsPostgres.ordinal',
    );
    expect(messageRepository).toContain('.leftJoinLateral(');
    expect(messageRepository).toContain('.limit(input.limit ?? 200)');
    expect(messageService).toContain('decodeGlobalMessageCursor');
    expect(messageRepository).not.toContain('SELECT m.*, p.payload_json');
    expect(messageRepository).not.toContain("AND p.kind = 'text'");
  });
});
