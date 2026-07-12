import { and, eq, isNull, sql } from 'drizzle-orm';

import type {
  PermissionPromotionCounter,
  PermissionPromotionRepository,
} from '../../../../domain/ports/permission-promotion.js';
import * as pgSchema from '../schema/schema.js';
import type { CanonicalDb } from './canonical-graph-repository.postgres.js';

const table = pgSchema.permissionPromotionCountersPostgres;

export class PostgresPermissionPromotionRepository implements PermissionPromotionRepository {
  constructor(private readonly db: CanonicalDb) {}

  async incrementAndGet(input: {
    appId: string;
    agentFolder: string;
    suggestionKey: string;
    nowIso: string;
  }): Promise<PermissionPromotionCounter> {
    const [row] = await this.db
      .insert(table)
      .values({
        appId: input.appId,
        agentFolder: input.agentFolder,
        suggestionKey: input.suggestionKey,
        allowCount: 1,
        lastOfferedAt: null,
        createdAt: input.nowIso,
        updatedAt: input.nowIso,
      })
      .onConflictDoUpdate({
        target: [table.appId, table.agentFolder, table.suggestionKey],
        set: {
          allowCount: sql`${table.allowCount} + 1`,
          updatedAt: input.nowIso,
        },
      })
      .returning();
    return mapRow(row);
  }

  async markOffered(input: {
    appId: string;
    agentFolder: string;
    suggestionKey: string;
    nowIso: string;
  }): Promise<boolean> {
    const rows = await this.db
      .update(table)
      .set({ lastOfferedAt: input.nowIso, updatedAt: input.nowIso })
      .where(
        and(
          eq(table.appId, input.appId),
          eq(table.agentFolder, input.agentFolder),
          eq(table.suggestionKey, input.suggestionKey),
          isNull(table.lastOfferedAt),
        ),
      )
      .returning({ suggestionKey: table.suggestionKey });
    return rows.length === 1;
  }
}

function mapRow(row: typeof table.$inferSelect): PermissionPromotionCounter {
  return {
    ...row,
    lastOfferedAt: row.lastOfferedAt ? toIsoTimestamp(row.lastOfferedAt) : null,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

function toIsoTimestamp(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}
