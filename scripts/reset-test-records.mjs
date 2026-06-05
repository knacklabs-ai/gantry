#!/usr/bin/env node
// Delete all test-persona data (conversations cascade to messages/parts/participants),
// CRM records, reconcile cursors, and memory; then seed one open lead for the
// returning-customer scenario. Boondi-side test-data setup; talks only to the shared DB.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PERSONA_PHONES, RETURNING_PHONE } from './lib/test-phones.mjs';

const { Client } = pg;
const CONN = process.env.BOONDI_CRM_DATABASE_URL || process.env.DATABASE_URL;
const SCHEMA = process.env.BOONDI_CRM_DB_SCHEMA || 'gantry';
if (!CONN) {
  console.error('Set BOONDI_CRM_DATABASE_URL or DATABASE_URL');
  process.exit(2);
}

const convIds = PERSONA_PHONES.map((p) => `conversation:wa:${p}`);

const client = new Client({ connectionString: CONN, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  // Fail fast instead of hanging if the freshly-booted runtime briefly holds a
  // lock on a persona conversation (idle work) — a clear error beats an infinite wait.
  await client.query(`set lock_timeout = '10s'`);
  await client.query(`set statement_timeout = '25s'`);
  await client.query(`set search_path to ${SCHEMA}`);
  await client.query(`delete from boondi_business_records where phone = any($1)`, [PERSONA_PHONES]);
  await client
    .query(`delete from boondi_reconcile_cursor where conversation_id = any($1)`, [convIds])
    .catch(() => {});
  await client
    .query(`delete from memory_items where user_id = any($1)`, [PERSONA_PHONES])
    .catch(() => {});
  // These tables have NO ACTION / SET NULL FKs to conversations (not cascade), so a
  // prior run's rows block deleting the conversation. Clear them first, children
  // before parents (runtime_events/agent_runs reference agent_sessions). memory_items
  // (deleted above) + the CASCADE children handle the rest.
  for (const tbl of ['runtime_events', 'jobs', 'agent_runs', 'agent_sessions']) {
    await client
      .query(`delete from ${tbl} where conversation_id = any($1)`, [convIds])
      .catch((e) => console.error(`  [reset] ${tbl}: ${e.message}`));
  }
  // Conversations cascade to messages -> message_parts and participants (FK onDelete cascade).
  await client.query(`delete from conversations where id = any($1)`, [convIds]);
  // The returning-customer scenario (919900000007) needs PRIOR conversation
  // history, not just an open record: the guardrail only lets a bare greeting
  // ("hi") reach Boondi when the conversation already has context — otherwise it
  // returns the canned first-contact greeting and the agent never runs (so
  // get_open_records never fires). Seed the realistic earlier exchange (the query
  // that became the seeded lead) using the real channel envelope, then the lead.
  const APP_ID = 'default';
  const PROVIDER = 'interakt';
  const PROVIDER_CONN = 'channel-providerConnection:default:interakt';
  const retConv = `conversation:wa:${RETURNING_PHONE}`;
  const dayMs = 24 * 60 * 60 * 1000;
  const tEarlier = new Date(Date.now() - 3 * dayMs).toISOString();
  const tEarlierReply = new Date(Date.now() - 3 * dayMs + 60_000).toISOString();
  await client.query(
    `insert into conversations
       (id, app_id, provider_connection_id, external_ref_json, kind, title, status, created_at, updated_at)
     values ($1,$2,$3,$4,'direct',$5,'active',$6,$6)`,
    [
      retConv,
      APP_ID,
      PROVIDER_CONN,
      JSON.stringify({
        kind: 'conversation',
        value: RETURNING_PHONE,
        jid: `wa:${RETURNING_PHONE}`,
        providerId: PROVIDER,
        externalConversationId: RETURNING_PHONE,
        isGroup: false,
      }),
      'Aarav (Acme Corp)',
      tEarlier,
    ],
  );
  // Seed an open lead for the returning-customer scenario so get_open_records has something.
  await client.query(
    `insert into boondi_business_records
       (id, phone, customer_name, conversation_id, status, intent_category,
        occasion, quantity, quantity_raw, buyer_type, summary_brief, source, score, band)
     values ($1,$2,$3,$4,'lead','corporate','Diwali',300,'around 300','employee_gifting',
        'Returning: ~300 Diwali boxes for the team (seeded for recognition test)','agent',77,'P2')`,
    [`bcr_${randomUUID()}`, RETURNING_PHONE, 'Aarav (Acme Corp)', `conversation:wa:${RETURNING_PHONE}`],
  );
  // Seed the prior exchange under that conversation so the greeting has context.
  // role is derived from direction/trust: inbound+trusted → customer, outbound+
  // system → assistant; content comes from the text message_part.
  const seedMsg = async (suffix, direction, trust, senderName, deliveryStatus, ts, text, ref) => {
    const id = `message:wa:${RETURNING_PHONE}:seed:${suffix}`;
    await client.query(
      `insert into messages
         (id, app_id, provider, provider_connection_id, conversation_id, direction,
          sender_user_id, sender_display_name, trust, created_at, received_at, delivery_status, delivered_at, external_ref_json)
       values ($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$9,$10,$11,$12)`,
      [id, APP_ID, PROVIDER, PROVIDER_CONN, retConv, direction, senderName, trust, ts, deliveryStatus, deliveryStatus ? ts : null, JSON.stringify(ref)],
    );
    await client.query(
      `insert into message_parts (message_id, ordinal, kind, payload_json) values ($1,0,'text',$2)`,
      [id, JSON.stringify({ kind: 'text', text })],
    );
  };
  await seedMsg(
    'in', 'inbound', 'trusted', 'Aarav (Acme Corp)', null, tEarlier,
    'Hi, I am looking at Diwali gift boxes for our team — around 300 boxes.',
    { is_from_me: false, is_bot_message: false },
  );
  await seedMsg(
    'out', 'outbound', 'system', 'Boondi', 'sent', tEarlierReply,
    'How lovely — 300 Diwali boxes for the team! I have noted the essentials; whenever you are ready, share your budget per box and the timeline and I will pull together the best options.',
    { is_from_me: true, is_bot_message: true },
  );
  console.log('reset+seed ok');
} finally {
  await client.end();
}
