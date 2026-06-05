import { describe, expect, it } from 'vitest';

import { buildUserQuestionRequestPayload } from '@core/runner/mcp/tools/user-question-payload.js';

// The ask_user_question request MUST carry the asking conversation's jid. Without
// it, the host falls back to a first-match-by-folder lookup, so under multiple
// concurrent customers of one agent the interactive question could be delivered to
// the WRONG customer (the same cross-conversation bleed class we fixed for replies).
describe('buildUserQuestionRequestPayload', () => {
  const base = {
    requestId: 'userq-1',
    sourceAgentFolder: 'boondi_support',
    targetJid: 'wa:919900020006',
    questions: [
      {
        header: 'Pick',
        question: 'Which delivery date?',
        options: [
          { label: 'Oct 15', description: 'mid' },
          { label: 'Oct 20', description: 'late' },
        ],
        multiSelect: false,
      },
    ],
    nowMs: 1_000_000,
    timeoutMs: 60_000,
  };

  it('stamps targetJid = the conversation chatJid', () => {
    const payload = buildUserQuestionRequestPayload(base);
    expect(payload.targetJid).toBe('wa:919900020006');
  });

  it('carries the requestId, folder, and questions through unchanged', () => {
    const payload = buildUserQuestionRequestPayload(base);
    expect(payload.requestId).toBe('userq-1');
    expect(payload.sourceAgentFolder).toBe('boondi_support');
    expect(payload.questions).toEqual(base.questions);
  });

  it('derives expiresAt from nowMs + timeoutMs', () => {
    const payload = buildUserQuestionRequestPayload(base);
    expect(payload.expiresAt).toBe(new Date(1_060_000).toISOString());
  });
});
