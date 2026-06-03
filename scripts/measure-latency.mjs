#!/usr/bin/env node
// TEMP latency probe (delete after use). Drives ONE full-flow turn through the
// running dev runtime and reports the per-step timeline from the flow log.
// Reset (/new) first so every condition measures a cold session identically.
// Usage: node scripts/measure-latency.mjs "<label>" "<message>"
import fs from 'node:fs';
import { sendWebhook } from './interakt-test-send.mjs';

const LOG = process.env.GANTRY_DEV_LOG || '/tmp/gantry-dev.log';
const FROM = process.env.MEASURE_FROM || '919654405340';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const size = () => {
  try {
    return fs.statSync(LOG).size;
  } catch {
    return 0;
  }
};
function slice(from) {
  const s = size();
  if (s <= from) return '';
  const fd = fs.openSync(LOG, 'r');
  try {
    const b = Buffer.alloc(s - from);
    fs.readSync(fd, b, 0, b.length, from);
    return b.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
function events(text) {
  const out = [];
  for (const l of text.split('\n')) {
    const m = l.match(
      /^\[([0-9T:.Z-]+)\].*?(flow:agent\.spawn|flow:llm\.input|flow:mcp\.request|flow:mcp\.response|flow:llm\.output|flow:outbound)/,
    );
    if (!m) continue;
    let tag = m[2];
    const t = l.match(/"toolName":"([^"]+)"/);
    if (t) tag += `(${t[1]})`;
    const rc = l.match(/"reply":"((?:[^"\\]|\\.)*)"/);
    const reset = rc && /Started a fresh session/.test(rc[1]);
    out.push({ ts: new Date(m[1]).getTime(), tag, reset, isOut: m[2] === 'flow:outbound' });
  }
  return out;
}

async function main() {
  const label = process.argv[2] || '(unlabeled)';
  const msg = process.argv[3] || 'Can you give me the full details of my most recent order?';

  // Cold reset.
  let off = size();
  await sendWebhook({ text: '/new', from: FROM });
  for (let i = 0; i < 25; i++) {
    if (/Started a fresh session/.test(slice(off))) break;
    await sleep(1000);
  }
  await sleep(1500);

  // Measured turn.
  off = size();
  await sendWebhook({ text: msg, from: FROM });
  let done = false;
  for (let i = 0; i < 90; i++) {
    if (events(slice(off)).some((e) => e.isOut && !e.reset)) {
      done = true;
      break;
    }
    await sleep(1000);
  }
  await sleep(800);
  const ev = events(slice(off));

  console.log(`\n=== ${label} ===`);
  console.log('delta(s) | event');
  let prev = null;
  for (const e of ev) {
    const d = prev ? ((e.ts - prev) / 1000).toFixed(1) : '0.0';
    console.log(String(d).padStart(7), '|', e.tag);
    prev = e.ts;
  }
  const first = ev[0];
  const out = [...ev].reverse().find((e) => e.isOut && !e.reset);
  const tools = ev.filter((e) => e.tag.startsWith('flow:mcp.request')).length;
  if (first && out) {
    console.log(
      `TOTAL first-event→reply: ${((out.ts - first.ts) / 1000).toFixed(1)}s | tool calls: ${tools} | captured=${done}`,
    );
  } else {
    console.log(`no reply captured (captured=${done})`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
