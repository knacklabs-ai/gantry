// Read-only access to Gantry's DURABLE transcript for the watcher.
// boondi-crm reads Gantry's messages — a one-way dependency; Gantry never
// depends on boondi-crm. Gantry's transcript tables are EXPLICITLY
// schema-qualified (the CRM's search_path is its own boondi_crm); these
// tables resolve in boondi_crm.

import type { Pool } from 'pg';

export interface TranscriptMessage { role: 'customer' | 'assistant'; text: string; }

// conversation id is "conversation:wa:<digits>"; the bare digits are the customer
// key used everywhere else (records.phone, memory_items.user_id).
export function phoneFromConversationId(conversationId: string): string | undefined {
  const match = conversationId.match(/wa:(\d+)/);
  return match ? match[1] : undefined;
}

// The conversation's text transcript, oldest→newest, role-tagged by direction.
export function transcriptSql(gantrySchema: string): string {
  return `SELECT m.direction, p.payload_json->>'text' AS text
       FROM ${gantrySchema}.messages m
       JOIN ${gantrySchema}.message_parts p ON p.message_id = m.id AND p.kind = 'text'
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC, p.ordinal ASC
      LIMIT $2`;
}

export async function loadTranscript(
  pool: Pool,
  gantrySchema: string,
  conversationId: string,
  maxMessages = 80,
): Promise<TranscriptMessage[]> {
  const res = await pool.query(transcriptSql(gantrySchema), [
    conversationId,
    maxMessages,
  ]);
  const out: TranscriptMessage[] = [];
  for (const row of res.rows) {
    const text = (row.text as string | null)?.trim();
    if (!text) continue;
    out.push({
      role: row.direction === 'inbound' ? 'customer' : 'assistant',
      text,
    });
  }
  return out;
}
