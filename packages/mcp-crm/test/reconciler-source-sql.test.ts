import { describe, expect, it } from 'vitest';

import {
  candidatesSql,
  transcriptSql,
} from '../src/reconciler/gantry-source.js';

// The CRM owns boondi_crm but READS Gantry's transcript. With the CRM's search_path
// now scoped to boondi_crm, those reads must be explicitly schema-qualified or they'd
// resolve to boondi_crm (where the tables don't live).
describe('reconciler gantry-source SQL builders', () => {
  it('qualifies the three gantry transcript tables with the configured schema', () => {
    const cs = candidatesSql('gantry');
    expect(cs).toMatch(/from\s+gantry\.messages/i);
    expect(cs).toMatch(/join\s+gantry\.conversations/i);

    const ts = transcriptSql('gantry');
    expect(ts).toMatch(/from\s+gantry\.messages/i);
    expect(ts).toMatch(/join\s+gantry\.message_parts/i);
  });

  it('honors a non-default gantry schema name', () => {
    expect(candidatesSql('gantry_v2')).toMatch(/gantry_v2\.messages/i);
    expect(transcriptSql('gantry_v2')).toMatch(/gantry_v2\.message_parts/i);
  });
});
