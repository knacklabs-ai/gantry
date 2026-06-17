import { describe, expect, it, vi } from 'vitest';

import {
  createOutboundOwnershipVerifier,
  ownershipMatchesDestination,
} from '@core/app/bootstrap/outbound-ownership-verifier.js';

describe('outbound ownership verifier', () => {
  it('accepts raw runtime ownership tokens for the matching destination', async () => {
    const verifyLeaseVersion = vi.fn(async () => true);
    const verifier = createOutboundOwnershipVerifier({ verifyLeaseVersion });

    await expect(
      verifier({
        destinationJid: 'wa:000000001',
        ownership: {
          appId: 'default',
          conversationId: 'wa:000000001',
          threadId: null,
          ownerInstanceId: 'runtime:1',
          leaseVersion: 3,
        },
      }),
    ).resolves.toBe(true);

    expect(verifyLeaseVersion).toHaveBeenCalledWith({
      appId: 'default',
      conversationId: 'wa:000000001',
      threadId: null,
      ownerInstanceId: 'runtime:1',
      leaseVersion: 3,
    });
  });

  it('accepts canonical ownership token ids for the matching runtime destination', () => {
    expect(
      ownershipMatchesDestination({
        destinationJid: 'wa:000000001',
        destinationThreadId: 'reply-1',
        ownership: {
          appId: 'default',
          conversationId: 'conversation:wa:000000001',
          threadId: 'thread:wa:000000001:reply-1',
          ownerInstanceId: 'runtime:1',
          leaseVersion: 3,
        },
      }),
    ).toBe(true);
  });

  it('rejects ownership tokens replayed to another destination', async () => {
    const verifyLeaseVersion = vi.fn(async () => true);
    const verifier = createOutboundOwnershipVerifier({ verifyLeaseVersion });

    await expect(
      verifier({
        destinationJid: 'wa:000000002',
        ownership: {
          appId: 'default',
          conversationId: 'wa:000000001',
          threadId: null,
          ownerInstanceId: 'runtime:1',
          leaseVersion: 3,
        },
      }),
    ).resolves.toBe(false);

    expect(verifyLeaseVersion).not.toHaveBeenCalled();
  });
});
