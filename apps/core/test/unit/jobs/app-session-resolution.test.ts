import { describe, expect, it, vi } from 'vitest';

import {
  resolveAppSessionForJob,
  resolveAppSessionForTrigger,
} from '@core/jobs/app-session-resolution.js';

const session = {
  appId: 'app-one',
  sessionId: 'session-1',
  defaultResponseMode: 'sse',
  defaultWebhookId: 'webhook-1',
} as const;

describe('job app session resolution', () => {
  it('prefers the stored session id when it resolves', async () => {
    const control = {
      getAppSessionById: vi.fn(async () => session),
      getAppSessionByChatJid: vi.fn(),
    };

    await expect(
      resolveAppSessionForJob(
        {
          session_id: 'session-1',
          linked_sessions: ['app:app-one:conv-1'],
        } as never,
        control,
      ),
    ).resolves.toEqual(session);
    expect(control.getAppSessionByChatJid).not.toHaveBeenCalled();
  });

  it('falls back to app linked session when stored session id is stale', async () => {
    const control = {
      getAppSessionById: vi.fn(async () => null),
      getAppSessionByChatJid: vi.fn(async () => session),
    };

    await expect(
      resolveAppSessionForJob(
        {
          session_id: 'stale-session',
          linked_sessions: ['app:app-one:conv-1'],
        } as never,
        control,
      ),
    ).resolves.toEqual(session);
    expect(control.getAppSessionByChatJid).toHaveBeenCalledWith(
      'app:app-one:conv-1',
    );
  });

  it('resolves trigger requester session ids only when present', async () => {
    const control = {
      getAppSessionById: vi.fn(async () => session),
      getAppSessionByChatJid: vi.fn(),
    };

    await expect(
      resolveAppSessionForTrigger(
        JSON.stringify({ kind: 'sdk', sessionId: 'session-1' }),
        control,
      ),
    ).resolves.toEqual(session);
    await expect(
      resolveAppSessionForTrigger('sdk', control),
    ).resolves.toBeUndefined();
  });
});
