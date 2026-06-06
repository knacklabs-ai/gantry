import { describe, expect, it, vi } from 'vitest';
import { makeFakePool, makeFakeRepo, stubLlm } from './helpers/fakes.js';
import { runDigestCycleOnce } from '../src/watcher/index.js';

const env = {
  gantrySchema: 'gantry', reconcileAgentId: 'agent:boondi_support',
  reconcileIntervalMs: 1, extractorModel: 'x', anthropicApiKey: 'x',
} as any;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } as any;
const llm = stubLlm(
  '{"opportunities":[{"match":null,"isLead":true,"occasion":"Diwali","quantity":200,"summaryBrief":"200 Diwali","evidenceQuote":"200 boxes","confidence":0.9}]}',
);

describe('runDigestCycleOnce', () => {
  it('extracts from a new digest, upserts, and advances the cursor', async () => {
    const { pool, query } = makeFakePool((sql) => {
      if (sql.includes('agent_session_digests')) {
        return { rows: [{ digest_id: 'd1', conversation_id: 'conversation:wa:9001', digest: 'digest text', created_at: '2026-06-06T00:00:00Z' }] };
      }
      if (sql.includes('message_parts')) {
        return { rows: [{ direction: 'inbound', text: 'I want 200 boxes for Diwali' }] };
      }
      return { rows: [] };
    });
    const repo = makeFakeRepo();
    const stats = await runDigestCycleOnce({ env, logger, pool, repo, llm });
    expect(stats.digests).toBe(1);
    expect(stats.created).toBe(1);
    expect(repo.upsertOpportunity).toHaveBeenCalledTimes(1);
    const advanced = query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO boondi_digest_cursor'));
    expect(advanced).toBe(true);
  });

  it('is a no-op when no digests are pending', async () => {
    const { pool } = makeFakePool(() => ({ rows: [] }));
    const repo = makeFakeRepo();
    const stats = await runDigestCycleOnce({ env, logger, pool, repo, llm });
    expect(stats.digests).toBe(0);
    expect(repo.upsertOpportunity).not.toHaveBeenCalled();
  });

  it('returns zeros when the llm is disabled (null)', async () => {
    const { pool } = makeFakePool(() => ({ rows: [] }));
    const repo = makeFakeRepo();
    const stats = await runDigestCycleOnce({ env, logger, pool, repo, llm: null });
    expect(stats.digests).toBe(0);
  });
});
