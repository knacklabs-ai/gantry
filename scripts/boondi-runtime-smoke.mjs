#!/usr/bin/env node
// Basic local runtime smoke for Boondi-on-Gantry.
//
// This intentionally does NOT judge Boondi product behavior, CRM extraction,
// reply wording, or Shopify catalogue semantics. It proves only:
//   1. core, shopify-api MCP, and boondi-crm MCP are reachable;
//   2. signed Interakt webhooks ACK;
//   3. inbound reaches guardrail/agent processing;
//   4. Gantry emits MCP proxy request/response events;
//   5. outbound dry-run emits a customer-visible send event.
//   6. duplicate provider message ids do not trigger duplicate runtime work.
//   7. authenticated runtime worker inventory is reachable.
// Set SMOKE_CONCURRENCY=3 to exercise the local three-warm-worker runtime
// hypothesis without enabling Boondi semantic assertions.
import fs from 'node:fs';

import { parseRuntimeSmokeEnv } from './lib/runtime-smoke-env.mjs';
import { sendWebhook } from './lib/webhook.mjs';

const smokeEnv = parseRuntimeSmokeEnv();
const LOG = smokeEnv.gantryDevLog || '/tmp/gantry-dev.log';
const CORE_PORT = Number(smokeEnv.controlPort || 4710);
const RUNTIME_WORKERS_PATH = '/v1/runtime/workers';
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS || 180_000);
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 1_000);
const DUPLICATE_SETTLE_MS = Number(
  process.env.SMOKE_DUPLICATE_SETTLE_MS || 5_000,
);
const SMOKE_CONCURRENCY = Math.max(
  1,
  Number(process.env.SMOKE_CONCURRENCY || 1),
);

const cases = [
  {
    name: 'shopify',
    phone: process.env.BOONDI_SMOKE_SHOPIFY_PHONE || '000000001',
    text: process.env.BOONDI_SMOKE_SHOPIFY_TEXT || 'Do you have kaju katli?',
    serverName: 'shopify-api',
  },
  {
    name: 'shopify-secondary',
    phone: process.env.BOONDI_SMOKE_SHOPIFY_SECONDARY_PHONE || '000000002',
    text:
      process.env.BOONDI_SMOKE_SHOPIFY_SECONDARY_TEXT ||
      'Can you show me sweets?',
    serverName: 'shopify-api',
  },
  {
    name: 'crm',
    phone: process.env.BOONDI_SMOKE_CRM_PHONE || '000000050',
    text: process.env.BOONDI_SMOKE_CRM_TEXT || 'hi',
    serverName: 'boondi-crm',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );
  return results;
}

function logSize() {
  try {
    return fs.statSync(LOG).size;
  } catch {
    return 0;
  }
}

function readLogSince(offset) {
  try {
    const fd = fs.openSync(LOG, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.min(offset, size);
      const buffer = Buffer.alloc(Math.max(0, size - start));
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function parseJsonLogLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function logContextMatchesChat(context, chatJid) {
  return context?.chatJid === chatJid || context?.jid === chatJid;
}

function hasFlowForChat(text, chatJid, flow, serverName) {
  return parseJsonLogLines(text).some((entry) => {
    const context = entry?.context;
    if (context?.flow !== flow) return false;
    if (!logContextMatchesChat(context, chatJid)) return false;
    return serverName ? context.serverName === serverName : true;
  });
}

function countFlowForChat(text, chatJid, flow, serverName) {
  return parseJsonLogLines(text).filter((entry) => {
    const context = entry?.context;
    if (context?.flow !== flow) return false;
    if (!logContextMatchesChat(context, chatJid)) return false;
    return serverName ? context.serverName === serverName : true;
  }).length;
}

function hasLogMessageForChat(text, chatJid, message) {
  return parseJsonLogLines(text).some(
    (entry) =>
      entry?.message === message && logContextMatchesChat(entry?.context, chatJid),
  );
}

async function waitFor(label, offset, predicate, timeoutMs = TURN_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = readLogSince(offset);
    if (predicate(last)) return last;
    await sleep(POLL_MS);
  }
  throw new Error(`timed out waiting for ${label}\nlast log:\n${last.slice(-4000)}`);
}

async function health(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  const text = await response.text();
  if (label === 'core') return response.status;
  if (!response.ok || !text.includes('"ok":true')) {
    throw new Error(`${label} health failed: HTTP ${response.status} ${text}`);
  }
  return response.status;
}

async function runtimeWorkersHealth() {
  if (!smokeEnv.controlToken) {
    throw new Error(
      'missing GANTRY_SMOKE_CONTROL_TOKEN; start the stack with npm run dev:boondi-runtime and run the printed GANTRY_RUNTIME_SMOKE_ENV command',
    );
  }
  const response = await fetch(
    `http://127.0.0.1:${CORE_PORT}${RUNTIME_WORKERS_PATH}`,
    {
      headers: {
        Authorization: `Bearer ${smokeEnv.controlToken}`,
      },
      signal: AbortSignal.timeout(3_000),
    },
  );
  const workerInventory = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `/v1/runtime/workers failed: HTTP ${response.status} ${JSON.stringify(workerInventory)}`,
    );
  }
  if (
    !workerInventory ||
    !Array.isArray(workerInventory.instances) ||
    workerInventory.healthyTotals.instances < 1
  ) {
    throw new Error(
      `/v1/runtime/workers returned invalid inventory: ${JSON.stringify(workerInventory)}`,
    );
  }
  return workerInventory;
}

async function sendCheckedWebhook(input) {
  const result = await sendWebhook({ ...input, port: CORE_PORT });
  if (!result.ok) {
    throw new Error(
      `${input.from} webhook rejected: HTTP ${result.status} ${result.response}`,
    );
  }
  return result;
}

async function runCase(smokeCase) {
  const chatJid = `wa:${smokeCase.phone}`;

  let offset = logSize();
  await sendCheckedWebhook({
    from: smokeCase.phone,
    text: '/new',
    name: 'Runtime Smoke',
  });
  await waitFor(
    `${smokeCase.name} reset outbound`,
    offset,
    (text) =>
      text.includes(chatJid) && text.includes('Started a fresh session.'),
    60_000,
  );

  offset = logSize();
  const firstTurn = await sendCheckedWebhook({
    from: smokeCase.phone,
    text: smokeCase.text,
    name: 'Runtime Smoke',
  });

  const finalLog = await waitFor(
    `${smokeCase.name} MCP response and outbound`,
    offset,
    (text) =>
      hasFlowForChat(text, chatJid, 'guardrail') &&
      hasFlowForChat(text, chatJid, 'mcp.request', smokeCase.serverName) &&
      hasFlowForChat(text, chatJid, 'mcp.response', smokeCase.serverName) &&
      hasFlowForChat(text, chatJid, 'outbound') &&
      hasLogMessageForChat(
        text,
        chatJid,
        'Outbound dry-run: sent to listed test number',
      ),
  );

  const duplicateOffset = logSize();
  await sendCheckedWebhook({
    from: smokeCase.phone,
    text: smokeCase.text,
    name: 'Runtime Smoke',
    messageId: firstTurn.messageId,
  });
  await sleep(DUPLICATE_SETTLE_MS);
  const duplicateLog = readLogSince(duplicateOffset);
  const duplicateRuntimeWork =
    hasFlowForChat(duplicateLog, chatJid, 'guardrail') ||
    hasFlowForChat(duplicateLog, chatJid, 'mcp.request', smokeCase.serverName) ||
    hasFlowForChat(duplicateLog, chatJid, 'mcp.response', smokeCase.serverName) ||
    hasFlowForChat(duplicateLog, chatJid, 'outbound');
  if (duplicateRuntimeWork) {
    throw new Error(
      `${smokeCase.name} duplicate inbound produced runtime work\n${duplicateLog.slice(-4000)}`,
    );
  }

  return {
    name: smokeCase.name,
    phone: smokeCase.phone,
    serverName: smokeCase.serverName,
    guardrail: countFlowForChat(finalLog, chatJid, 'guardrail'),
    mcpRequest: countFlowForChat(
      finalLog,
      chatJid,
      'mcp.request',
      smokeCase.serverName,
    ),
    mcpResponse: countFlowForChat(
      finalLog,
      chatJid,
      'mcp.response',
      smokeCase.serverName,
    ),
    outbound: countFlowForChat(finalLog, chatJid, 'outbound'),
    duplicateInbound: true,
  };
}

async function main() {
  await health(`http://127.0.0.1:${CORE_PORT}/`, 'core');
  await health('http://127.0.0.1:8081/healthz', 'shopify-api');
  await health('http://127.0.0.1:8082/healthz', 'boondi-crm');
  await runtimeWorkersHealth();

  const results = await mapPool(cases, SMOKE_CONCURRENCY, runCase);
  console.log(
    JSON.stringify({ ok: true, concurrency: SMOKE_CONCURRENCY, results }, null, 2),
  );
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
