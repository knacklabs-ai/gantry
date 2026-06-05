// Content-level cross-conversation bleed scanner — NEW run only, scenario-specific signatures.
// The DB accumulates rows across runs, so we filter to created_at >= the re-run boot.
// Probes are DISTINCTIVE per-scenario signatures (not generic words like "nut-free" or
// "Diwali" which legitimately recur across gifting chats) so a hit is high-confidence bleed.
import pg from 'pg';

const CONN = process.env.GANTRY_DATABASE_URL;
const SCHEMA = 'gantry';
const SINCE = process.env.BLEED_SINCE || '2026-06-04T14:08:00.000Z';

// (label, regex, ownerPhones[]) — a NON-owner conversation matching is candidate bleed.
const SIGNATURES = [
  { label: 'wedding(06): 250 boxes / big family occasion / daughter getting married',
    re: /250 box|big family occasion|getting marri|wedding next month|my daughter(?:'s)?\s+(?:wedding|is getting marri)/i,
    owners: ['919900020006'] },
  { label: 'order#90627(04): the specific order id / choco butterscotch / dispatch',
    re: /#?90627|choco butterscotch bark/i,
    owners: ['919624194499'] },
  { label: 'allergy(07): severe/life-threatening allergy phrasing',
    re: /severely allergic|life[- ]threatening|epipen|anaphyla/i,
    owners: ['919900020007'] },
  { label: 'corporate-email(03): priya@finbox.in',
    re: /priya@finbox\.in/i,
    owners: ['919900020003'] },
];

const PHONES = ['919900020001','919900020002','919900020003','919624194499','919900020005','919900020006','919900020007','919900020008','919900020009','919900020010','919900020011','919900020012','919900020013','919900020014','919900020015','919900020016','919900020017','919900020018'];

const c = new pg.Client({ connectionString: CONN });
await c.connect();

async function repliesFor(phone) {
  const r = await c.query(
    `select mp.payload_json->>'text' as text
       from ${SCHEMA}.messages m
       join ${SCHEMA}.message_parts mp on mp.message_id = m.id
      where m.conversation_id = $1 and m.direction = 'outbound'
        and mp.kind = 'text' and m.created_at >= $2
      order by m.created_at asc`,
    [`conversation:wa:${phone}`, SINCE],
  );
  return r.rows.map((x) => x.text).filter(Boolean);
}

const perPhone = {};
for (const p of PHONES) perPhone[p] = await repliesFor(p);

console.log(`=== NEW-run reply counts per conversation (since ${SINCE}) ===`);
for (const p of PHONES) console.log(p.padEnd(14), perPhone[p].length, 'replies');

let bleeds = 0;
console.log('\n=== scenario-signature cross-bleed scan (NEW replies only) ===');
for (const { label, re, owners } of SIGNATURES) {
  let any = false;
  for (const p of PHONES) {
    if (owners.includes(p)) continue;
    for (const text of perPhone[p]) {
      const m = text.match(re);
      if (m) {
        bleeds++; any = true;
        console.log(`\n❌ BLEED: ${label}`);
        console.log(`   appeared in ${p} (belongs to ${owners.join(',')}):`);
        const i = Math.max(0, m.index - 45);
        console.log(`   …${text.slice(i, m.index + 70).replace(/\n/g, ' ')}…`);
      }
    }
  }
  if (!any) console.log(`✅ clean: ${label.split(':')[0]} — confined to its own conversation`);
}

console.log(`\n=== RESULT: ${bleeds === 0 ? '✅ NO CROSS-CONVERSATION BLEED IN THE POST-FIX RUN' : `❌ ${bleeds} bleed signal(s)`} ===`);
await c.end();
