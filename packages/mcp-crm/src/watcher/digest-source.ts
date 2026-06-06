import type { Pool } from 'pg';

export interface PendingDigest {
  digestId: string;
  conversationId: string;
  digestText: string;
  digestAt: string;
}

// Session-end digests for Boondi conversations not yet processed by THIS watcher.
// The digest row's existence = "session ended + digest ready" (Gantry writes it
// before facts/cursor). agentId scopes to Boondi; we only key off the conversation.
export function pendingDigestsSql(gantrySchema: string): string {
  return `SELECT d.id AS digest_id, s.conversation_id, d.digest, d.created_at
            FROM ${gantrySchema}.agent_session_digests d
            JOIN ${gantrySchema}.agent_sessions s ON s.id = d.agent_session_id
            LEFT JOIN boondi_digest_cursor c ON c.conversation_id = s.conversation_id
           WHERE d.trigger = 'session-end'
             AND s.agent_id = $1
             AND s.conversation_id LIKE 'conversation:wa:%'
             AND (c.last_digest_at IS NULL OR d.created_at > c.last_digest_at)
           ORDER BY d.created_at ASC
           LIMIT $2`;
}

export async function findNewDigests(
  pool: Pool, gantrySchema: string, agentId: string, limit = 25,
): Promise<PendingDigest[]> {
  const res = await pool.query(pendingDigestsSql(gantrySchema), [agentId, limit]);
  return res.rows.map((r) => ({
    digestId: r.digest_id as string,
    conversationId: r.conversation_id as string,
    digestText: (r.digest as string | null) ?? '',
    digestAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function advanceDigestCursor(
  pool: Pool, conversationId: string, digestId: string, digestAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO boondi_digest_cursor (conversation_id, last_digest_id, last_digest_at, checked_at)
       VALUES ($1,$2,$3, now())
     ON CONFLICT (conversation_id) DO UPDATE
       SET last_digest_id = EXCLUDED.last_digest_id,
           last_digest_at = EXCLUDED.last_digest_at, checked_at = now()`,
    [conversationId, digestId, digestAt],
  );
}
