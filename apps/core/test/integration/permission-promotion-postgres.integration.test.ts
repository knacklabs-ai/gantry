import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPostgresIntegrationRuntime,
  hasPostgresIntegrationDatabase,
  type PostgresIntegrationRuntime,
} from '../harness/postgres-integration-runtime.js';

const maybeDescribe = hasPostgresIntegrationDatabase ? describe : describe.skip;

maybeDescribe('Postgres permission promotion counters', () => {
  let runtime: PostgresIntegrationRuntime;

  beforeAll(async () => {
    runtime = await createPostgresIntegrationRuntime({
      schemaPrefix: 'permission_promotion',
    });
  });

  afterAll(async () => {
    if (runtime) await runtime.cleanup();
  });

  it('increments atomically and claims a promotion offer once', async () => {
    const repository = runtime.repositories.permissionPromotions;
    const input = {
      appId: 'app-one',
      agentFolder: 'main_agent',
      suggestionKey: 'main_agent|mcp__github__get_issue',
      nowIso: '2026-07-12T00:00:00.000Z',
    };
    await expect(repository.incrementAndGet(input)).resolves.toMatchObject({
      allowCount: 1,
      lastOfferedAt: null,
    });
    await repository.incrementAndGet(input);
    await expect(repository.incrementAndGet(input)).resolves.toMatchObject({
      allowCount: 3,
      lastOfferedAt: null,
    });
    await expect(repository.markOffered(input)).resolves.toBe(true);
    await expect(repository.markOffered(input)).resolves.toBe(false);
    await expect(repository.incrementAndGet(input)).resolves.toMatchObject({
      allowCount: 4,
      lastOfferedAt: input.nowIso,
    });
  });
});
