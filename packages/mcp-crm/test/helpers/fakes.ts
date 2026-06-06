import { vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

// Fake pg pool/client. Program `respond(sql, params) => { rows }` per test by
// branching on the SQL text. Both pool.query and client.query use it.
export function makeFakePool(
  respond: (sql: string, params?: unknown[]) => { rows: any[] },
) {
  const query = vi.fn((sql: string, params?: unknown[]) =>
    Promise.resolve(respond(sql, params)),
  );
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { query, connect: vi.fn(() => Promise.resolve(client)) } as unknown as Pool;
  return { pool, query };
}

// Fake RecordsRepository — stub only what the unit under test calls.
export function makeFakeRepo(over: Record<string, unknown> = {}) {
  return {
    getOpenOpportunitiesByPhone: vi.fn(async () => []),
    upsertOpportunity: vi.fn(async (p: any) => ({
      id: p.match ?? 'bcr_new',
      status: p.targetLead ? 'lead' : 'query',
      ...p,
    })),
    ...over,
  } as any;
}

export const stubLlm = (text: string) => ({ complete: vi.fn(async () => text) });
