import { describe, expect, it, vi } from 'vitest';

import { bootstrapFirstAdminUser } from '../src/admin-bootstrap.js';
import type { BoondiCrmEnv } from '../src/env.js';
import type { Logger } from '../src/logger.js';
import { makeFakePool } from './helpers/fakes.js';

const baseEnv: BoondiCrmEnv = {
  port: 8082,
  databaseUrl: 'postgres://test',
  dbSchema: 'boondi_crm',
  gantrySchema: 'gantry',
  identity: { mode: 'disabled' },
  requireVerifiedIdentity: false,
  identityMaxAgeSec: 120,
  logLevel: 'fatal',
  logFormat: 'json',
  crmLeadQueryExtractionWatcher: {
    enabled: true,
    pollIntervalMs: 1,
    model: 'test',
    maxParallelExtractions: 1,
    batchSize: 1,
    dbPoolSize: 3,
  },
  reconcileAgentId: 'agent:boondi_support',
  modelAppId: 'default',
};

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

describe('bootstrapFirstAdminUser', () => {
  it('does nothing when bootstrap env is absent', async () => {
    const calls: string[] = [];
    const { pool } = makeFakePool((sql) => {
      calls.push(sql);
      return { rows: [] };
    });

    await bootstrapFirstAdminUser({ env: baseEnv, pool, logger: logger() });

    expect(calls).toEqual([]);
  });

  it('creates one super_admin when the user table is empty', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const { pool } = makeFakePool((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
      if (sql.includes('RETURNING')) {
        return {
          rows: [
            {
              id: 'owner',
              email: params?.[1],
              role: params?.[3],
              status: 'active',
              created_at: '2026-06-23T00:00:00.000Z',
              updated_at: '2026-06-23T00:00:00.000Z',
              last_login_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await bootstrapFirstAdminUser({
      env: {
        ...baseEnv,
        adminBootstrapEmail: 'Owner@Boondi.Local',
        adminBootstrapPassword: 'correct horse battery',
      },
      pool,
      logger: logger(),
    });

    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO boondi_admin_users'),
    );
    expect(insert?.params?.[1]).toBe('owner@boondi.local');
    expect(insert?.params?.[2]).toMatch(/^scrypt\$/);
    expect(insert?.params?.[3]).toBe('super_admin');
  });
});
