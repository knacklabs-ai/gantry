// Bleed scan from the FLOW LOG (ground truth: every routed reply with its jid, NEW run only
// because the log was truncated at core restart). Each line: ... flow:outbound {json}.
// Probes are DISTINCTIVE per-scenario signatures so a hit in a non-owner conversation is
// high-confidence cross-conversation bleed.
import fs from 'node:fs';

const LOG = process.argv[2] || '/tmp/gantry-capture.log';
const lines = fs.readFileSync(LOG, 'utf-8').split('\n');

const byJid = new Map(); // jid -> [reply,...]
for (const ln of lines) {
  const i = ln.indexOf('flow:outbound {');
  if (i < 0) continue;
  try {
    const obj = JSON.parse(ln.slice(ln.indexOf('{', i)));
    if (obj.flow !== 'outbound' || !obj.reply) continue;
    const jid = (obj.jid || '').replace(/^wa:/, '');
    if (!byJid.has(jid)) byJid.set(jid, []);
    byJid.get(jid).push(obj.reply);
  } catch { /* skip non-JSON */ }
}

const SIGNATURES = [
  { label: 'wedding(06): 250 boxes / big family occasion / daughter getting married',
    re: /250 ?box|big family occasion|getting marri|daughter(?:'s)?\s+(?:wedding|is getting marri)|wedding next month/i,
    owners: ['919900020006'] },
  // NOTE: product names (e.g. "Choco Butterscotch Barks") recur legitimately across chats as
  // recommendations; the UNIQUE-to-04 facts are the order id, AWB, and courier.
  { label: 'order#90627(04): unique order id / BlueDart AWB / courier',
    re: /#?90627|90214763520|blue ?dart/i,
    owners: ['919624194499'] },
  { label: 'allergy(07): severe / life-threatening allergy phrasing',
    re: /severely allergic|life[- ]threatening|epipen|anaphyla/i,
    owners: ['919900020007'] },
  { label: 'corporate(03): priya@finbox.in',
    re: /priya@finbox\.in/i,
    owners: ['919900020003'] },
];

const STDLINE = (s) => (s || '').replace(/\n/g, ' ');
console.log('=== replies captured per conversation (flow log, this run only) ===');
for (const [jid, arr] of [...byJid].sort()) console.log(jid.padEnd(14), arr.length, 'replies');

let bleeds = 0;
console.log('\n=== scenario-signature cross-bleed scan ===');
for (const { label, re, owners } of SIGNATURES) {
  let any = false;
  for (const [jid, arr] of byJid) {
    if (owners.includes(jid)) continue;
    for (const reply of arr) {
      const m = reply.match(re);
      if (m) {
        bleeds++; any = true;
        console.log(`\n❌ BLEED: ${label}\n   in ${jid} (owner=${owners.join(',')}):`);
        const k = Math.max(0, m.index - 50);
        console.log(`   …${STDLINE(reply.slice(k, m.index + 70))}…`);
      }
    }
  }
  if (!any) console.log(`✅ clean: ${label.split(':')[0]} — confined to its own conversation`);
}

// Positive confirmation: each signature DID appear in its rightful owner (proves the probe works).
console.log('\n=== probe sanity: signature present in its OWNER (confirms scan is live) ===');
for (const { label, re, owners } of SIGNATURES) {
  const hit = owners.some((o) => (byJid.get(o) || []).some((r) => re.test(r)));
  console.log(`${hit ? '✓' : '–'} ${label.split(':')[0]} present in owner ${owners.join(',')} ${hit ? '' : '(owner had no such reply yet)'}`);
}

console.log(`\n=== RESULT: ${bleeds === 0 ? '✅ NO CROSS-CONVERSATION BLEED (flow-log ground truth)' : `❌ ${bleeds} bleed signal(s)`} ===`);
