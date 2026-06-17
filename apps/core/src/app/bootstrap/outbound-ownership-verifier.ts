import type {
  OutboundOwnershipVerifier,
  OutboundOwnershipVerificationInput,
} from './channel-wiring-types.js';
import type {
  ConversationOwnerLeaseRepository,
  VerifyConversationOwnerLeaseInput,
} from '../../domain/ports/conversation-owner-lease-repository.js';

function runtimeConversationId(conversationId: string): string {
  return conversationId.startsWith('conversation:')
    ? conversationId.slice('conversation:'.length)
    : conversationId;
}

function runtimeThreadId(
  conversationId: string,
  threadId?: string | null,
): string | null {
  if (!threadId) return null;
  const prefix = `thread:${conversationId}:`;
  return threadId.startsWith(prefix) ? threadId.slice(prefix.length) : threadId;
}

export function ownershipMatchesDestination(
  input: OutboundOwnershipVerificationInput,
): boolean {
  const tokenConversationId = runtimeConversationId(
    input.ownership.conversationId,
  );
  if (tokenConversationId !== input.destinationJid) return false;
  const tokenThreadId = runtimeThreadId(
    tokenConversationId,
    input.ownership.threadId,
  );
  return tokenThreadId === (input.destinationThreadId ?? null);
}

export function createOutboundOwnershipVerifier(input: {
  verifyLeaseVersion: ConversationOwnerLeaseRepository['verifyLeaseVersion'];
}): OutboundOwnershipVerifier {
  return async (verificationInput) => {
    if (!ownershipMatchesDestination(verificationInput)) return false;
    const verifyInput: VerifyConversationOwnerLeaseInput = {
      appId: verificationInput.ownership.appId,
      conversationId: verificationInput.destinationJid,
      threadId: verificationInput.destinationThreadId ?? null,
      ownerInstanceId: verificationInput.ownership.ownerInstanceId,
      leaseVersion: verificationInput.ownership.leaseVersion,
    };
    return input.verifyLeaseVersion(verifyInput);
  };
}
