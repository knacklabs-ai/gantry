import { describe, expect, it } from 'vitest';
import {
  buildExtractionMessages,
  EXTRACTION_SYSTEM_PROMPT,
} from '../src/extractor/prompt.js';

describe('buildExtractionMessages', () => {
  it('includes existing opps, digest, and transcript', () => {
    const [msg] = buildExtractionMessages({
      conversationId: 'conversation:wa:9111', phone: '9111',
      transcript: [{ role: 'customer', text: 'I want 50 boxes' }],
      digestText: 'prior: 100 box Mumbai order',
      openOpportunities: [{ id: 'bcr_x', summary: 'Diwali 100 boxes' }],
    });
    expect(msg.content).toContain('bcr_x: Diwali 100 boxes');
    expect(msg.content).toContain('prior: 100 box Mumbai order');
    expect(msg.content).toContain('customer: I want 50 boxes');
  });

  it('renders "(none)" when there are no existing opps', () => {
    const [msg] = buildExtractionMessages({
      conversationId: 'c', phone: '9', transcript: [], digestText: 'd',
      openOpportunities: [],
    });
    expect(msg.content).toContain('EXISTING OPEN OPPORTUNITIES for this customer:\n(none)');
  });

  it('defines B2B client gifting separately from staff corporate gifting', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(
      'gifting_b2b = gifting to clients, partners, VIPs, or other businesses',
    );
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(
      'corporate = company buying for its own staff, employees, office, or team',
    );
  });
});
