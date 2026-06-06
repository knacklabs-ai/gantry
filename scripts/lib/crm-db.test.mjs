import { describe, it, expect } from 'vitest';
import { matchFailures, assertRecord } from './crm-db.mjs';

// Small fake DB rows. Real rows use snake_case columns straight from Postgres;
// expectations use camelCase. Helpers keep each test focused on the fields it
// actually exercises.
const row = (over = {}) => ({
  status: 'query',
  intent_category: null,
  buyer_type: null,
  location_scope: null,
  customisation: null,
  score: null,
  band: null,
  source: null,
  occasion: null,
  quantity: null,
  needs_review: false,
  ...over,
});

describe('matchFailures', () => {
  it('a query row satisfies {status:"query"}', () => {
    expect(matchFailures(row({ status: 'query' }), { status: 'query' })).toEqual([]);
  });

  it('a qualifying row also satisfies {status:"query"}', () => {
    // "query" expectation is the pre-lead bucket: query OR qualifying both pass.
    expect(matchFailures(row({ status: 'qualifying' }), { status: 'query' })).toEqual([]);
  });

  it('a lead row with a numeric score satisfies {status:"lead", scored:true}', () => {
    expect(
      matchFailures(row({ status: 'lead', score: 77 }), { status: 'lead', scored: true }),
    ).toEqual([]);
  });

  it('flags a missing numeric score under scored:true', () => {
    const f = matchFailures(row({ status: 'lead', score: null }), {
      status: 'lead',
      scored: true,
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/expected a numeric score/);
  });

  it('intent_category "shopping" FAILS {intentCategory:"corporate"}', () => {
    const f = matchFailures(row({ intent_category: 'shopping' }), {
      intentCategory: 'corporate',
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/intent corporate, got shopping/);
  });

  it('minScore: row score 80 passes minScore:70 but fails minScore:90', () => {
    expect(matchFailures(row({ score: 80 }), { minScore: 70 })).toEqual([]);
    const f = matchFailures(row({ score: 80 }), { minScore: 90 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/score >= 90, got 80/);
  });
});

describe('assertRecord', () => {
  it('{absent:true} passes when records=[]', () => {
    expect(assertRecord([], { absent: true })).toEqual([]);
  });

  it('{absent:true} FAILS when a record exists', () => {
    const f = assertRecord([row({ status: 'lead' })], { absent: true });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/expected NO opportunity row, found 1/);
  });

  it('passes if SOME row matches the expectation', () => {
    const records = [
      row({ status: 'query', intent_category: 'shopping' }),
      row({ status: 'lead', intent_category: 'corporate', score: 81 }),
    ];
    expect(assertRecord(records, { status: 'lead', intentCategory: 'corporate' })).toEqual([]);
  });

  it('FAILS with a "closest" message when no row matches', () => {
    const records = [
      row({ status: 'query', intent_category: 'shopping' }),
      row({ status: 'qualifying', intent_category: 'gifting_b2b' }),
    ];
    const f = assertRecord(records, { status: 'lead', intentCategory: 'corporate' });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/no row matched/);
    expect(f[0]).toMatch(/closest:/);
  });

  it('empty records + a non-absent expectation FAILS with "none found"', () => {
    const f = assertRecord([], { status: 'lead' });
    expect(f).toEqual(['expected an opportunity row, none found']);
  });
});
