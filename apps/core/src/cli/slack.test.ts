import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeSlackChatJid,
  validateSlackAppToken,
  validateSlackBotToken,
  verifySlackChatAccess,
} from './slack.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cli slack helpers', () => {
  it('normalizes valid Slack chat ids', () => {
    expect(normalizeSlackChatJid('C0123456789')).toBe('sl:C0123456789');
    expect(normalizeSlackChatJid('sl:g0123456789')).toBe('sl:G0123456789');
    expect(normalizeSlackChatJid(' d12345678 ')).toBe('sl:D12345678');
  });

  it('rejects invalid Slack chat ids', () => {
    expect(normalizeSlackChatJid('')).toBeNull();
    expect(normalizeSlackChatJid('abc')).toBeNull();
    expect(normalizeSlackChatJid('sl:bad id')).toBeNull();
  });

  it('validates Slack bot token with auth.test', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          team: 'My Workspace',
          team_id: 'T123',
          user_id: 'U123',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await validateSlackBotToken('xoxb-valid-token');

    expect(result.ok).toBe(true);
    expect(result.teamId).toBe('T123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects non-xapp app token prefix immediately', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await validateSlackAppToken('xoxb-not-app-token');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('must start with xapp-');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('verifies chat access and sends a test message', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: { id: 'C0123456789', name: 'ops-room' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            ts: '1710000000.000100',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await verifySlackChatAccess({
      botToken: 'xoxb-valid-token',
      chatJid: 'sl:C0123456789',
      sendTestMessage: true,
    });

    expect(result.ok).toBe(true);
    expect(result.chatTitle).toBe('ops-room');
    expect(result.sentTestMessage).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
