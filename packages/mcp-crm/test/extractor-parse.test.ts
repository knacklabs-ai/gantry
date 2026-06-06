import { describe, expect, it } from 'vitest';
import { extractOpportunities } from '../src/extractor/extract.js';
import type { ExtractorLlm } from '../src/extractor/llm-client.js';

const stub = (text: string): ExtractorLlm => ({ complete: async () => text });
const input = {
  conversationId: 'c', phone: '9', transcript: [], digestText: '',
  openOpportunities: [],
};

describe('extractOpportunities', () => {
  it('parses valid JSON (with surrounding prose tolerated)', async () => {
    const out = await extractOpportunities(
      stub('Here you go: {"opportunities":[{"match":null,"isLead":true,"quantity":100,"summaryBrief":"100 boxes","evidenceQuote":"100 boxes","confidence":0.9}]}'),
      input,
    );
    expect(out?.opportunities[0].quantity).toBe(100);
    expect(out?.opportunities[0].match).toBeNull();
  });

  it('returns null on invalid/garbage output', async () => {
    expect(await extractOpportunities(stub('sorry, no json'), input)).toBeNull();
    expect(await extractOpportunities(stub('{"opportunities":[{"isLead":"yes"}]}'), input)).toBeNull();
  });
});
