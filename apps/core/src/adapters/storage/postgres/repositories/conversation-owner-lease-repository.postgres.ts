import { and, asc, eq, lte, or, sql } from 'drizzle-orm';

import type {
  ClaimConversationOwnerLeaseInput,
  ClaimConversationOwnerLeaseResult,
  ConversationOwnerLeaseRecord,
  ConversationOwnerLeaseRepository,
  ConversationOwnerLeaseState,
  FindExpiredConversationOwnerLeasesInput,
  HeartbeatConversationOwnerLeaseInput,
  MarkConversationOwnerLeasesDrainingInput,
  ReleaseConversationOwnerLeaseInput,
  VerifyConversationOwnerLeaseInput,
} from '../../../../domain/ports/conversation-owner-lease-repository.js';
import { conversationOwnerThreadKey } from '../../../../domain/ports/conversation-owner-lease-repository.js';
import * as pgSchema from '../schema/schema.js';
import {
  conversationIdForJid,
  threadIdFor,
  type CanonicalDb,
} from './canonical-graph-repository.postgres.js';

type LeaseRow = typeof pgSchema.conversationOwnerLeasesPostgres.$inferSelect;

function isoInstant(value: Date | undefined): string {
  return (value ?? new Date()).toISOString();
}

function leaseExpiry(now: Date | undefined, leaseTtlMs: number): string {
  const startedAt = now ?? new Date();
  return new Date(startedAt.getTime() + Math.max(0, leaseTtlMs)).toISOString();
}

function normalizeTimestamp(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function normalizeNullableTimestamp(value: string | null): string | null {
  return value === null ? null : normalizeTimestamp(value);
}

function storageConversationId(conversationId: string): string {
  return conversationId.startsWith('conversation:')
    ? conversationId
    : conversationIdForJid(conversationId);
}

function runtimeConversationId(conversationId: string): string {
  return conversationId.startsWith('conversation:')
    ? conversationId.slice('conversation:'.length)
    : conversationId;
}

function storageThreadId(
  conversationId: string,
  threadId?: string | null,
): string | null {
  if (!threadId) return null;
  return threadId.startsWith('thread:')
    ? threadId
    : threadIdFor(conversationId, threadId);
}

function runtimeThreadId(
  conversationId: string,
  threadId: string | null,
): string | null {
  if (!threadId) return null;
  const prefix = `thread:${runtimeConversationId(conversationId)}:`;
  return threadId.startsWith(prefix) ? threadId.slice(prefix.length) : threadId;
}

function keyWhere(input: {
  appId: string;
  conversationId: string;
  threadId?: string | null;
}) {
  const durableConversationId = storageConversationId(input.conversationId);
  return and(
    eq(pgSchema.conversationOwnerLeasesPostgres.appId, input.appId),
    eq(
      pgSchema.conversationOwnerLeasesPostgres.conversationId,
      durableConversationId,
    ),
    eq(
      pgSchema.conversationOwnerLeasesPostgres.threadKey,
      conversationOwnerThreadKey(input.threadId),
    ),
  );
}

function mapLease(row: LeaseRow): ConversationOwnerLeaseRecord {
  return {
    appId: row.appId,
    conversationId: runtimeConversationId(row.conversationId),
    threadId: runtimeThreadId(row.conversationId, row.threadId),
    threadKey: row.threadKey,
    ownerInstanceId: row.ownerInstanceId,
    workerId: row.workerId,
    leaseVersion: row.leaseVersion,
    leaseExpiresAt: normalizeTimestamp(row.leaseExpiresAt),
    heartbeatAt: normalizeTimestamp(row.heartbeatAt),
    state: row.state as ConversationOwnerLeaseState,
    lastClaimReason: row.lastClaimReason,
    lastError: row.lastError,
    drainingStartedAt: normalizeNullableTimestamp(row.drainingStartedAt),
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

function isExpired(row: LeaseRow, nowIso: string): boolean {
  return Date.parse(row.leaseExpiresAt) <= Date.parse(nowIso);
}

export class PostgresConversationOwnerLeaseRepository implements ConversationOwnerLeaseRepository {
  constructor(private readonly db: CanonicalDb) {}

  async claimLease(
    input: ClaimConversationOwnerLeaseInput,
  ): Promise<ClaimConversationOwnerLeaseResult> {
    const nowIso = isoInstant(input.now);
    const expiresAt = leaseExpiry(input.now, input.leaseTtlMs);
    const durableConversationId = storageConversationId(input.conversationId);
    const durableThreadId = storageThreadId(
      input.conversationId,
      input.threadId,
    );
    const threadKey = conversationOwnerThreadKey(input.threadId);

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(pgSchema.conversationOwnerLeasesPostgres)
        .values({
          appId: input.appId,
          conversationId: durableConversationId,
          threadId: durableThreadId,
          threadKey,
          ownerInstanceId: input.ownerInstanceId,
          workerId: input.workerId ?? null,
          leaseVersion: 1,
          leaseExpiresAt: expiresAt,
          heartbeatAt: nowIso,
          state: 'active',
          lastClaimReason: input.reason ?? null,
          lastError: null,
          drainingStartedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted[0]) {
        return { acquired: true, lease: mapLease(inserted[0]) };
      }

      const rows = await tx
        .select()
        .from(pgSchema.conversationOwnerLeasesPostgres)
        .where(keyWhere(input))
        .limit(1)
        .for('update');
      const current = rows[0];
      if (!current) {
        throw new Error('Conversation owner lease disappeared after conflict');
      }

      if (current.ownerInstanceId === input.ownerInstanceId) {
        if (current.state === 'draining') {
          return { acquired: false, lease: mapLease(current) };
        }
        const refreshed = await tx
          .update(pgSchema.conversationOwnerLeasesPostgres)
          .set({
            workerId: input.workerId ?? current.workerId,
            leaseExpiresAt: expiresAt,
            heartbeatAt: nowIso,
            lastClaimReason: input.reason ?? current.lastClaimReason,
            updatedAt: nowIso,
          })
          .where(keyWhere(input))
          .returning();
        return { acquired: true, lease: mapLease(refreshed[0] ?? current) };
      }

      if (current.state === 'active' && !isExpired(current, nowIso)) {
        return { acquired: false, lease: mapLease(current) };
      }

      const takeover = await tx
        .update(pgSchema.conversationOwnerLeasesPostgres)
        .set({
          ownerInstanceId: input.ownerInstanceId,
          workerId: input.workerId ?? null,
          leaseVersion: sql`${pgSchema.conversationOwnerLeasesPostgres.leaseVersion} + 1`,
          leaseExpiresAt: expiresAt,
          heartbeatAt: nowIso,
          state: 'active',
          lastClaimReason: input.reason ?? null,
          lastError: null,
          drainingStartedAt: null,
          updatedAt: nowIso,
        })
        .where(keyWhere(input))
        .returning();

      return { acquired: true, lease: mapLease(takeover[0] ?? current) };
    });
  }

  async heartbeatLease(
    input: HeartbeatConversationOwnerLeaseInput,
  ): Promise<ConversationOwnerLeaseRecord | null> {
    const nowIso = isoInstant(input.now);
    const expiresAt = leaseExpiry(input.now, input.leaseTtlMs);
    const rows = await this.db
      .update(pgSchema.conversationOwnerLeasesPostgres)
      .set({
        leaseExpiresAt: expiresAt,
        heartbeatAt: nowIso,
        updatedAt: nowIso,
      })
      .where(
        and(
          keyWhere(input),
          eq(
            pgSchema.conversationOwnerLeasesPostgres.ownerInstanceId,
            input.ownerInstanceId,
          ),
          eq(
            pgSchema.conversationOwnerLeasesPostgres.leaseVersion,
            input.leaseVersion,
          ),
          eq(pgSchema.conversationOwnerLeasesPostgres.state, 'active'),
        ),
      )
      .returning();
    return rows[0] ? mapLease(rows[0]) : null;
  }

  async verifyLeaseVersion(
    input: VerifyConversationOwnerLeaseInput,
  ): Promise<boolean> {
    const nowIso = isoInstant(input.now);
    const rows = await this.db
      .select({ appId: pgSchema.conversationOwnerLeasesPostgres.appId })
      .from(pgSchema.conversationOwnerLeasesPostgres)
      .where(
        and(
          keyWhere(input),
          eq(
            pgSchema.conversationOwnerLeasesPostgres.ownerInstanceId,
            input.ownerInstanceId,
          ),
          eq(
            pgSchema.conversationOwnerLeasesPostgres.leaseVersion,
            input.leaseVersion,
          ),
          eq(pgSchema.conversationOwnerLeasesPostgres.state, 'active'),
          sql`${pgSchema.conversationOwnerLeasesPostgres.leaseExpiresAt} > ${nowIso}`,
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  async markDraining(
    input: MarkConversationOwnerLeasesDrainingInput,
  ): Promise<number> {
    const nowIso = isoInstant(input.now);
    const rows = await this.db
      .update(pgSchema.conversationOwnerLeasesPostgres)
      .set({
        state: 'draining',
        drainingStartedAt: nowIso,
        lastClaimReason: input.reason ?? 'instance_draining',
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(
            pgSchema.conversationOwnerLeasesPostgres.ownerInstanceId,
            input.ownerInstanceId,
          ),
          eq(pgSchema.conversationOwnerLeasesPostgres.state, 'active'),
        ),
      )
      .returning({ appId: pgSchema.conversationOwnerLeasesPostgres.appId });
    return rows.length;
  }

  async releaseLease(
    input: ReleaseConversationOwnerLeaseInput,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(pgSchema.conversationOwnerLeasesPostgres)
      .where(
        and(
          keyWhere(input),
          eq(
            pgSchema.conversationOwnerLeasesPostgres.ownerInstanceId,
            input.ownerInstanceId,
          ),
          eq(
            pgSchema.conversationOwnerLeasesPostgres.leaseVersion,
            input.leaseVersion,
          ),
        ),
      )
      .returning({ appId: pgSchema.conversationOwnerLeasesPostgres.appId });
    return rows.length === 1;
  }

  async findExpiredOrUnownedWork(
    input: FindExpiredConversationOwnerLeasesInput,
  ): Promise<ConversationOwnerLeaseRecord[]> {
    const nowIso = isoInstant(input.now);
    const rows = await this.db
      .select()
      .from(pgSchema.conversationOwnerLeasesPostgres)
      .where(
        or(
          lte(pgSchema.conversationOwnerLeasesPostgres.leaseExpiresAt, nowIso),
          eq(pgSchema.conversationOwnerLeasesPostgres.state, 'draining'),
        ),
      )
      .orderBy(
        asc(pgSchema.conversationOwnerLeasesPostgres.leaseExpiresAt),
        asc(pgSchema.conversationOwnerLeasesPostgres.updatedAt),
      )
      .limit(input.limit);
    return rows.map(mapLease);
  }
}
