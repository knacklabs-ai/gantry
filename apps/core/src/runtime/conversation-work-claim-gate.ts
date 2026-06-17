import type {
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
  ConversationOwnerLeaseRecord,
  ReleaseConversationOwnerLeaseInput,
} from '../domain/ports/conversation-owner-lease-repository.js';

interface ConversationWorkClaimGateInput {
  claimLease: (
    input: ClaimConversationOwnerLeaseInput,
  ) => Promise<ClaimConversationOwnerLeaseResult>;
}

const DEFAULT_IN_FLIGHT_CLAIM_RELEASE_WAIT_MS = 1_000;

export interface ConversationWorkClaimGate {
  claimLease(
    input: ClaimConversationOwnerLeaseInput,
  ): Promise<ClaimConversationOwnerLeaseResult>;
  releaseTrackedLeases(input: {
    releaseLease: (
      releaseInput: ReleaseConversationOwnerLeaseInput,
    ) => Promise<boolean>;
    inFlightClaimWaitMs?: number;
  }): Promise<void>;
  close(reason?: string): void;
}

function trackedLeaseKey(lease: ConversationOwnerLeaseRecord): string {
  return [
    lease.appId,
    lease.conversationId,
    lease.threadId ?? '',
    lease.ownerInstanceId,
  ].join('\0');
}

function closedClaimsError(reason: string): Error {
  return new Error(`Conversation work owner claims are closed: ${reason}`);
}

export function createConversationWorkClaimGate(
  input: ConversationWorkClaimGateInput,
): ConversationWorkClaimGate {
  let closedReason: string | undefined;
  const trackedLeases = new Map<string, ReleaseConversationOwnerLeaseInput>();
  const inFlightClaims = new Set<Promise<void>>();

  async function waitForInFlightClaims(timeoutMs: number): Promise<void> {
    const deadlineMs = Date.now() + Math.max(0, timeoutMs);
    while (inFlightClaims.size > 0) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) return;

      const currentClaims = Array.from(inFlightClaims);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), remainingMs);
      });
      const result = await Promise.race([
        Promise.allSettled(currentClaims).then(() => 'claims_settled' as const),
        timeout,
      ]);
      if (timeoutId) clearTimeout(timeoutId);
      if (result === 'timeout') return;
    }
  }

  return {
    async claimLease(claimInput) {
      if (closedReason) {
        throw closedClaimsError(closedReason);
      }
      const claim = input.claimLease(claimInput);
      const inFlight = claim.then(
        () => undefined,
        () => undefined,
      );
      inFlightClaims.add(inFlight);
      try {
        const result = await claim;
        if (result.acquired) {
          trackedLeases.set(trackedLeaseKey(result.lease), {
            appId: result.lease.appId,
            conversationId: result.lease.conversationId,
            threadId: result.lease.threadId,
            ownerInstanceId: result.lease.ownerInstanceId,
            leaseVersion: result.lease.leaseVersion,
          });
        }
        if (closedReason) {
          throw closedClaimsError(closedReason);
        }
        return result;
      } finally {
        inFlightClaims.delete(inFlight);
      }
    },
    async releaseTrackedLeases({ releaseLease, inFlightClaimWaitMs }) {
      await waitForInFlightClaims(
        inFlightClaimWaitMs ?? DEFAULT_IN_FLIGHT_CLAIM_RELEASE_WAIT_MS,
      );
      const releases = Array.from(trackedLeases.values());
      trackedLeases.clear();
      let firstError: unknown;
      for (const releaseInput of releases) {
        try {
          await releaseLease(releaseInput);
        } catch (err) {
          firstError ??= err;
        }
      }
      if (firstError) throw firstError;
    },
    close(reason = 'closed') {
      closedReason = reason;
    },
  };
}
