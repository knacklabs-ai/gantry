import { describe, expect, it, vi } from 'vitest';

import { SessionInteractionModule } from '@core/application/sessions/session-interaction-module.js';

function makeModule() {
  const control = {
    ensureAppSession: vi.fn(async (input) => ({
      sessionId: 'session-1',
      appId: input.appId,
      conversationId: input.conversationId,
      chatJid: input.chatJid,
      workspaceKey: input.folder,
      defaultResponseMode: input.defaultResponseMode ?? 'sse',
      defaultWebhookId: input.defaultWebhookId ?? null,
    })),
    getWebhookById: vi.fn(),
  };
  const module = new SessionInteractionModule({
    control: control as never,
    ops: {} as never,
    repositories: {} as never,
    runtimeEvents: {} as never,
    now: () => '2026-04-30T00:00:00.000Z' as never,
    createId: () => 'id-1',
    stableHash: () => '123456789abc',
  });
  return { module, control };
}

describe('SessionInteractionModule', () => {
  it('rejects non-canonical conversation ids before creating app chat ids', async () => {
    const { module, control } = makeModule();

    await expect(
      module.ensureSession({
        appId: 'app-one',
        conversationId: 'bad:conversation',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message:
        'appId and conversationId must contain only letters, numbers, dot, underscore, or dash',
    });
    expect(control.ensureAppSession).not.toHaveBeenCalled();
  });
});
