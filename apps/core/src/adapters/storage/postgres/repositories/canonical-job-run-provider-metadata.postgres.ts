import { and, inArray, sql } from 'drizzle-orm';

import * as pgSchema from '../schema/schema.js';
import type { CanonicalDb } from './canonical-graph-repository.postgres.js';

export async function updateCanonicalJobRunProviderMetadata(
  db: CanonicalDb,
  runId: string | readonly string[],
  input: {
    leaseToken?: string;
    providerRunId?: string | null;
    providerSessionId?: string | null;
  },
): Promise<void> {
  const updates: Partial<typeof pgSchema.agentRunsPostgres.$inferInsert> = {};
  if (input.providerRunId !== undefined)
    updates.providerRunId = input.providerRunId;
  if (input.providerSessionId !== undefined) {
    updates.providerSessionId = input.providerSessionId;
  }
  if (Object.keys(updates).length === 0) return;
  const runIds = Array.isArray(runId) ? [...new Set(runId)] : [runId];
  if (runIds.length === 0) return;
  await db
    .update(pgSchema.agentRunsPostgres)
    .set(updates)
    .where(
      and(
        inArray(pgSchema.agentRunsPostgres.id, runIds),
        ...(input.leaseToken
          ? [
              sql`EXISTS (
                SELECT 1 FROM ${pgSchema.runLeasesPostgres}
                WHERE ${pgSchema.runLeasesPostgres.runId} = ${pgSchema.agentRunsPostgres.id}
                  AND ${pgSchema.runLeasesPostgres.leaseToken} = ${input.leaseToken}
                  AND ${pgSchema.runLeasesPostgres.status} = 'active'
                  AND ${pgSchema.runLeasesPostgres.expiresAt} > now()
              )`,
            ]
          : []),
      ),
    );
}
