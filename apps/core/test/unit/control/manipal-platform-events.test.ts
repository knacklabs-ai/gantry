import { describe, expect, it } from 'vitest';

import {
  buildManipalPlatformMessage,
  signManipalEventRequest,
  verifyManipalEventSignature,
} from '@core/control/server/routes/manipal-platform-events.js';

const envelope = {
  eventId: 'outbox-1',
  eventType: 'tender_first_notice_requested',
  occurredAt: '2026-05-18T10:00:00.000Z',
  payload: {
    eventType: 'tender_first_notice_requested',
    tenderId: 'tender-1',
    tenderCanonicalId: 'canon-1',
    title: 'MRI scanner maintenance tender',
    referenceNo: 'MPL-001',
    organization: 'Manipal Hospital',
    deadline: '2026-05-31',
    sourceUrl: 'https://example.test/tender',
    workspaceTargets: [
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Biomedical',
        teamsChannelId: '19:channel@thread.v2',
        matchedKeywords: ['mri'],
      },
    ],
    documentAttachment: {
      downloadStatus: 'missing',
    },
    requestedAt: '2026-05-18T10:00:00.000Z',
  },
};

describe('Manipal platform event adapter helpers', () => {
  it('signs and verifies Manipal event requests', () => {
    const rawBody = JSON.stringify(envelope);
    const signature = signManipalEventRequest({
      secret: 'secret',
      method: 'POST',
      path: '/v1/apps/manipal/platform-events',
      timestamp: '1000',
      nonce: 'nonce-1',
      rawBody,
    });

    expect(
      verifyManipalEventSignature({
        secret: 'secret',
        method: 'POST',
        path: '/v1/apps/manipal/platform-events',
        timestamp: '1000',
        nonce: 'nonce-1',
        rawBody,
        signature,
        nowMs: 1000,
      }),
    ).toBe(true);
    expect(
      verifyManipalEventSignature({
        secret: 'wrong',
        method: 'POST',
        path: '/v1/apps/manipal/platform-events',
        timestamp: '1000',
        nonce: 'nonce-1',
        rawBody,
        signature,
        nowMs: 1000,
      }),
    ).toBe(false);
  });

  it('rejects stale timestamps', () => {
    const rawBody = JSON.stringify(envelope);
    const signature = signManipalEventRequest({
      secret: 'secret',
      method: 'POST',
      path: '/v1/apps/manipal/platform-events',
      timestamp: '1000',
      nonce: 'nonce-1',
      rawBody,
    });

    expect(
      verifyManipalEventSignature({
        secret: 'secret',
        method: 'POST',
        path: '/v1/apps/manipal/platform-events',
        timestamp: '1000',
        nonce: 'nonce-1',
        rawBody,
        signature,
        nowMs: 10 * 60_000,
      }),
    ).toBe(false);
  });

  it('builds deterministic Teams text for first notice events', () => {
    expect(buildManipalPlatformMessage(envelope)).toContain(
      'New tender found: MRI scanner maintenance tender',
    );
    expect(buildManipalPlatformMessage(envelope)).toContain(
      'Organization: Manipal Hospital',
    );
  });
});
