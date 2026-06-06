import { describe, expect, it } from 'vitest';
import { makeFakePool } from './helpers/fakes.js';
import { RecordsRepository } from '../src/db/records-repository.js';

// values()/INSERT order — used to reconstruct the RETURNING row from params.
const COLUMN_ORDER = [
  'id','phone','customer_name','conversation_id','status','intent_category',
  'occasion','quantity','quantity_raw','budget_per_gift_inr','budget_total_inr',
  'budget_raw','locations','location_scope','timeline','timeline_days','buyer_type',
  'customisation','contact_quality','score','band','summary_brief','trigger_excerpt',
  'source','confidence','needs_review',
];
const zip = (params: unknown[] = []) =>
  Object.fromEntries(COLUMN_ORDER.map((c, i) => [c, params[i] ?? null]));

const openRow = (over: Record<string, unknown>) => ({
  id: 'bcr_x', phone: '9111', status: 'query', intent_category: 'other',
  score: null, band: null, needs_review: false, ...over,
});

describe('RecordsRepository.getOpenOpportunitiesByPhone', () => {
  it('returns all open rows mapped to records', async () => {
    const { pool } = makeFakePool((sql) => {
      if (sql.includes("status IN ('query','qualifying','lead')")) {
        return { rows: [openRow({ id: 'bcr_a' }), openRow({ id: 'bcr_b', status: 'lead' })] };
      }
      return { rows: [] };
    });
    const repo = new RecordsRepository(pool);
    const open = await repo.getOpenOpportunitiesByPhone('9111');
    expect(open.map((r) => r.id)).toEqual(['bcr_a', 'bcr_b']);
    expect(open[1].status).toBe('lead');
  });
});

describe('RecordsRepository.upsertOpportunity', () => {
  it('inserts a new lead and computes a score (match=null)', async () => {
    const { pool } = makeFakePool((sql, params) => {
      if (sql.includes('RETURNING')) return { rows: [zip(params)] };
      return { rows: [] };
    });
    const repo = new RecordsRepository(pool);
    const saved = await repo.upsertOpportunity({
      match: null, phone: '9111', conversationId: 'conversation:wa:9111',
      input: { occasion: 'Quarterly', quantity: 300, budgetPerGiftInr: 600,
        buyerType: 'employee_gifting', locationScope: 'multi_city', timelineDays: 5 },
      targetLead: true, source: 'extractor', confidence: 0.9, needsReview: false,
    });
    expect(saved.status).toBe('lead');
    expect(typeof saved.score).toBe('number');
    expect(saved.band).not.toBeNull();
    expect(saved.confidence).toBe(0.9);
  });

  it('updates an existing opportunity by id (match=bcr_x)', async () => {
    const { pool } = makeFakePool((sql, params) => {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [openRow({ id: 'bcr_x', status: 'query', quantity: 10 })] };
      }
      if (sql.includes('RETURNING')) return { rows: [zip(params)] };
      return { rows: [] };
    });
    const repo = new RecordsRepository(pool);
    const saved = await repo.upsertOpportunity({
      match: 'bcr_x', phone: '9111', conversationId: 'conversation:wa:9111',
      input: { quantity: 300 }, targetLead: true, source: 'extractor',
      confidence: 0.95, needsReview: false,
    });
    expect(saved.id).toBe('bcr_x');
    expect(saved.quantity).toBe(300);
    expect(saved.status).toBe('lead');
  });

  it('flags needsReview through to the row', async () => {
    const { pool } = makeFakePool((sql, params) => {
      if (sql.includes('RETURNING')) return { rows: [zip(params)] };
      return { rows: [] };
    });
    const repo = new RecordsRepository(pool);
    const saved = await repo.upsertOpportunity({
      match: null, phone: '9111', conversationId: 'conversation:wa:9111',
      input: { occasion: 'x' }, targetLead: false, source: 'extractor',
      confidence: 0.3, needsReview: true,
    });
    expect(saved.needsReview).toBe(true);
  });
});
