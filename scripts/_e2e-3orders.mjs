#!/usr/bin/env node
// Throwaway e2e driver (_): sends a fresh 3-order WhatsApp conversation from a
// FAKE number through the live Interakt webhook, so the digest-watcher extractor
// produces ~3 scored opportunities. Verifies the per-opportunity model + the
// split-brain fix (CRM keys off the conversation phone, not the Shopify override).
//   node scripts/_e2e-3orders.mjs
import { sendWebhook } from './interakt-test-send.mjs';

const FROM = process.env.E2E_FROM || '919000000001';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const turns = [
  // No '/new' — it is admin-gated ("Session commands require admin access") and a
  // fresh fake number has no prior session anyway. Core must run with
  // GANTRY_OUTBOUND_DRYRUN=1 so replies are logged (not sent), bypassing the
  // WhatsApp 24h-window send that fails for numbers that never messaged us.
  'Hi! I want to order sweets for a few different occasions, can you help?',
  'First order: 50 boxes of kaju katli for Raksha Bandhan. Budget around 300 per box. Please deliver to Delhi. I need them next week.',
  "Second, a separate order: 100 boxes for my company's quarterly celebration at our Mumbai office. Around 100 rupees per box, with our company logo printed on the boxes. Needed in 10 days.",
  'Also add another separate order: 10 more boxes with the same logo branding for Mumbai. This is a different order from the 100.',
];

console.log(`[e2e] sending ${turns.length} turns from ${FROM}`);
for (let i = 0; i < turns.length; i += 1) {
  const text = turns[i];
  try {
    const r = await sendWebhook({ text, from: FROM });
    console.log(`[e2e] turn ${i} ok=${r.ok} status=${r.status} jid=${r.chatJid} "${text.slice(0, 48)}"`);
  } catch (err) {
    console.error(`[e2e] turn ${i} FAILED: ${err.message}`);
    process.exit(1);
  }
  // Give the agent time to process each turn before the next arrives.
  if (i < turns.length - 1) await delay(6000);
}
console.log(`[e2e] all turns sent at ${new Date().toISOString()}. Now the session must go idle (idle_end_minutes) before the session-end digest fires.`);
