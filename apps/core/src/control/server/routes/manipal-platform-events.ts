import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { envValueDynamic } from '../../../config/env/index.js';
import { getRuntimeStorage } from '../../../adapters/storage/postgres/runtime-store.js';
import type { ControlRouteContext } from '../handler-context.js';
import { readRawBody, sendError, sendJson } from '../http.js';

const MANIPAL_EVENTS_PATH = '/v1/apps/manipal/platform-events';
const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_TOLERANCE_MS = 5 * 60_000;
const EVENT_TYPES = new Set([
  'tender_first_notice_requested',
  'captcha_resolution_requested',
  'scrape_repair_requested',
  'tender_processing_completed',
  'tender_processing_failed',
  'tender_processing_update_available',
  'tender_workspace_backfill_requested',
]);

type PlatformEventEnvelope = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export async function handleManipalPlatformEventRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ControlRouteContext,
  pathname: string,
): Promise<boolean> {
  if (pathname !== MANIPAL_EVENTS_PATH) return false;
  if (req.method !== 'POST') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return true;
  }

  const secret = envValueDynamic('GANTRY_MANIPAL_EVENT_SECRET');
  if (!secret) {
    sendError(
      res,
      503,
      'RUNTIME_NOT_CONFIGURED',
      'GANTRY_MANIPAL_EVENT_SECRET is not configured',
    );
    return true;
  }

  const headers = readManipalSignatureHeaders(req, res);
  if (!headers) return true;
  const rawBody = await readManipalRawBody(req, res);
  if (rawBody === null) return true;

  if (
    !verifyManipalEventSignature({
      secret,
      method: req.method,
      path: pathname,
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      rawBody,
      signature: headers.signature,
    })
  ) {
    sendError(res, 403, 'FORBIDDEN', 'Invalid Manipal platform event signature');
    return true;
  }

  const envelope = parseManipalEnvelope(rawBody);
  if (!envelope.ok) {
    sendError(res, 400, 'INVALID_REQUEST', envelope.error);
    return true;
  }

  const accepted = await acceptManipalEvent(ctx, envelope.value, rawBody);
  sendJson(res, 202, accepted);
  return true;
}

export function signManipalEventRequest(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  return createHmac('sha256', input.secret)
    .update(buildManipalSignaturePayload(input))
    .digest('hex');
}

export function verifyManipalEventSignature(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  signature: string;
  nowMs?: number;
}): boolean {
  const timestampMs = Number(input.timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs((input.nowMs ?? Date.now()) - timestampMs) >
      SIGNATURE_TOLERANCE_MS
  ) {
    return false;
  }
  const expected = signManipalEventRequest(input);
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildManipalPlatformMessage(
  envelope: PlatformEventEnvelope,
): string {
  const payload = envelope.payload;
  if (envelope.eventType === 'tender_first_notice_requested') {
    const title = readOptionalString(payload.title) ?? 'New tender';
    const organization = readOptionalString(payload.organization);
    const referenceNo = readOptionalString(payload.referenceNo);
    const deadline = readOptionalString(payload.deadline);
    const sourceUrl = readOptionalString(payload.sourceUrl);
    return [
      `New tender found: ${title}`,
      organization ? `Organization: ${organization}` : undefined,
      referenceNo ? `Reference: ${referenceNo}` : undefined,
      deadline ? `Deadline: ${deadline}` : undefined,
      sourceUrl ? `Source: ${sourceUrl}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (envelope.eventType === 'captcha_resolution_requested') {
    return [
      `Captcha assist requested for ${readOptionalString(payload.websiteName) ?? 'website'}.`,
      `Run: ${readOptionalString(payload.runId) ?? 'unknown'}`,
      `Step: ${readOptionalString(payload.stepPath) ?? 'unknown'}`,
    ].join('\n');
  }
  if (envelope.eventType === 'scrape_repair_requested') {
    return [
      `Scrape repair requested for ${readOptionalString(payload.websiteName) ?? 'website'}.`,
      `Failure: ${readOptionalString(payload.failureType) ?? 'unknown'}`,
      readOptionalString(payload.errorSummary) ?? undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return `Manipal platform event received: ${envelope.eventType}`;
}

function buildManipalSignaturePayload(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  return [
    input.method.trim().toUpperCase(),
    input.path.trim(),
    input.timestamp.trim(),
    input.nonce.trim(),
    input.rawBody,
  ].join('\n');
}

function readManipalSignatureHeaders(
  req: IncomingMessage,
  res: ServerResponse,
): { timestamp: string; nonce: string; signature: string } | null {
  const timestamp = header(req, 'x-gantry-manipal-event-timestamp');
  const nonce = header(req, 'x-gantry-manipal-event-nonce');
  const signature = header(req, 'x-gantry-manipal-event-signature');
  const missing = [
    ['x-gantry-manipal-event-timestamp', timestamp],
    ['x-gantry-manipal-event-nonce', nonce],
    ['x-gantry-manipal-event-signature', signature],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    sendError(
      res,
      400,
      'INVALID_REQUEST',
      `Missing required Manipal event signature header: ${missing.join(', ')}`,
    );
    return null;
  }
  return { timestamp, nonce, signature };
}

async function readManipalRawBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string | null> {
  try {
    return (await readRawBody(req, MAX_BODY_BYTES)).toString('utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 413
    ) {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
      return null;
    }
    throw error;
  }
}

function parseManipalEnvelope(
  rawBody: string,
): { ok: true; value: PlatformEventEnvelope } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'Invalid JSON body' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Event envelope must be an object' };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.eventId !== 'string' || !record.eventId.trim()) {
    return { ok: false, error: 'eventId is required' };
  }
  if (
    typeof record.eventType !== 'string' ||
    !EVENT_TYPES.has(record.eventType)
  ) {
    return { ok: false, error: 'eventType is invalid' };
  }
  if (typeof record.occurredAt !== 'string' || !record.occurredAt.trim()) {
    return { ok: false, error: 'occurredAt is required' };
  }
  if (
    !record.payload ||
    typeof record.payload !== 'object' ||
    Array.isArray(record.payload)
  ) {
    return { ok: false, error: 'payload is required' };
  }
  return {
    ok: true,
    value: {
      eventId: record.eventId.trim(),
      eventType: record.eventType,
      occurredAt: record.occurredAt.trim(),
      payload: record.payload as Record<string, unknown>,
    },
  };
}

async function acceptManipalEvent(
  ctx: ControlRouteContext,
  envelope: PlatformEventEnvelope,
  rawBody: string,
) {
  const now = new Date().toISOString();
  const targetJid = resolveTargetJid(envelope);
  const insert = await getRuntimeStorage().service.pool.query<{
    event_id: string;
  }>(
    `INSERT INTO manipal_platform_events
       (event_id, event_type, target_jid, status, payload_json, received_at, updated_at)
     VALUES ($1, $2, $3, 'accepted', $4, $5, $5)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [envelope.eventId, envelope.eventType, targetJid, rawBody, now],
  );
  const duplicate = insert.rowCount === 0;
  if (!duplicate && targetJid) {
    await dispatchManipalEventToRuntime(ctx, envelope, targetJid);
  }
  return {
    accepted: true,
    duplicate,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    targetJid,
  };
}

async function dispatchManipalEventToRuntime(
  ctx: ControlRouteContext,
  envelope: PlatformEventEnvelope,
  targetJid: string,
): Promise<void> {
  const message = buildManipalPlatformMessage(envelope);
  try {
    await ctx.app.sendChannelMessage(targetJid, message);
    await updateManipalEventStatus(envelope.eventId, 'delivered', null, {
      targetJid,
    });
  } catch (error) {
    await updateManipalEventStatus(
      envelope.eventId,
      'accepted',
      error instanceof Error ? error.message : String(error),
      { targetJid },
    );
  }
}

async function updateManipalEventStatus(
  eventId: string,
  status: string,
  error: string | null,
  response: unknown,
): Promise<void> {
  await getRuntimeStorage().service.pool.query(
    `UPDATE manipal_platform_events
     SET status = $2, error = $3, response_json = $4, updated_at = $5
     WHERE event_id = $1`,
    [eventId, status, error, JSON.stringify(response ?? {}), new Date().toISOString()],
  );
}

function resolveTargetJid(envelope: PlatformEventEnvelope): string | null {
  if (envelope.eventType === 'tender_first_notice_requested') {
    const targets = envelope.payload.workspaceTargets;
    if (Array.isArray(targets)) {
      const first = targets.find(
        (target): target is Record<string, unknown> =>
          target !== null && typeof target === 'object',
      );
      return normalizeTeamsJid(readOptionalString(first?.teamsChannelId));
    }
  }
  if (envelope.eventType === 'captcha_resolution_requested') {
    return normalizeTeamsJid(
      readOptionalString(envelope.payload.captchaAdminChannelId),
    );
  }
  return null;
}

function normalizeTeamsJid(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.startsWith('teams:') ? value : `teams:${value}`;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  return raw.trim();
}
