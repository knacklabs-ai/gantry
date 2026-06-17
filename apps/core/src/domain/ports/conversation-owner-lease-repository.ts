export type ConversationOwnerLeaseState = 'active' | 'draining';

export interface ConversationOwnerLeaseKey {
  appId: string;
  conversationId: string;
  threadId?: string | null;
}

export interface ConversationOwnerLeaseRecord extends ConversationOwnerLeaseKey {
  threadId: string | null;
  threadKey: string;
  ownerInstanceId: string;
  workerId: string | null;
  leaseVersion: number;
  leaseExpiresAt: string;
  heartbeatAt: string;
  state: ConversationOwnerLeaseState;
  lastClaimReason: string | null;
  lastError: string | null;
  drainingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimConversationOwnerLeaseInput extends ConversationOwnerLeaseKey {
  ownerInstanceId: string;
  workerId?: string | null;
  leaseTtlMs: number;
  now?: Date;
  reason?: string | null;
}

export interface ClaimConversationOwnerLeaseResult {
  acquired: boolean;
  lease: ConversationOwnerLeaseRecord;
}

export interface HeartbeatConversationOwnerLeaseInput extends ConversationOwnerLeaseKey {
  ownerInstanceId: string;
  leaseVersion: number;
  leaseTtlMs: number;
  now?: Date;
}

export interface VerifyConversationOwnerLeaseInput extends ConversationOwnerLeaseKey {
  ownerInstanceId: string;
  leaseVersion: number;
  now?: Date;
}

export interface MarkConversationOwnerLeasesDrainingInput {
  ownerInstanceId: string;
  now?: Date;
  reason?: string | null;
}

export interface ReleaseConversationOwnerLeaseInput extends ConversationOwnerLeaseKey {
  ownerInstanceId: string;
  leaseVersion: number;
}

export interface FindExpiredConversationOwnerLeasesInput {
  now?: Date;
  limit: number;
}

export interface ConversationOwnerLeaseRepository {
  claimLease(
    input: ClaimConversationOwnerLeaseInput,
  ): Promise<ClaimConversationOwnerLeaseResult>;
  heartbeatLease(
    input: HeartbeatConversationOwnerLeaseInput,
  ): Promise<ConversationOwnerLeaseRecord | null>;
  verifyLeaseVersion(
    input: VerifyConversationOwnerLeaseInput,
  ): Promise<boolean>;
  markDraining(
    input: MarkConversationOwnerLeasesDrainingInput,
  ): Promise<number>;
  releaseLease(input: ReleaseConversationOwnerLeaseInput): Promise<boolean>;
  findExpiredOrUnownedWork(
    input: FindExpiredConversationOwnerLeasesInput,
  ): Promise<ConversationOwnerLeaseRecord[]>;
}

export function conversationOwnerThreadKey(threadId?: string | null): string {
  return threadId ?? '';
}
