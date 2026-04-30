import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApplicationError } from '../../../application/common/application-error.js';
import type { RuntimeEvent } from '../../../domain/events/events.js';
import { logger } from '../../../infrastructure/logging/logger.js';
import { resolveAppScopeAppId } from '../app-identity.js';
import { isValidControlId } from '../../../application/app-scope/control-id.js';
import {
  authorizeControlRequest,
  type ControlRouteContext,
} from '../handler-context.js';
import { readJson, sendError, sendJson } from '../http.js';
import { parseSessionRoute } from '../route-parser.js';
import {
  acceptMessageForControl,
  createSessionInteractionModule,
  ensureSessionForControl,
  type SessionEventSubscription,
} from '../session-interaction-adapter.js';

function sendApplicationError(res: ServerResponse, error: unknown): boolean {
  if (!(error instanceof ApplicationError)) return false;
  switch (error.code) {
    case 'NOT_FOUND':
      sendError(
        res,
        404,
        error.message === 'Webhook not found'
          ? 'WEBHOOK_NOT_FOUND'
          : 'SESSION_NOT_FOUND',
        error.message,
      );
      return true;
    case 'FORBIDDEN':
      sendError(res, 403, 'FORBIDDEN', error.message);
      return true;
    case 'INVALID_REQUEST':
      sendError(res, 400, 'INVALID_REQUEST', error.message);
      return true;
    case 'WAIT_TIMEOUT':
      sendError(res, 408, 'WAIT_TIMEOUT', error.message);
      return true;
    default:
      throw error;
  }
}

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ControlRouteContext,
  url: URL,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/v1/sessions/ensure' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'sessions:write',
    ]);
    if (!auth) return true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const assertedAppId =
      typeof body.appId === 'string' ? body.appId.trim() : '';
    const appId = resolveAppScopeAppId(auth, assertedAppId);
    const conversationId = String(body.conversationId || '').trim();
    if (!conversationId) {
      sendError(res, 400, 'INVALID_REQUEST', 'conversationId is required');
      return true;
    }
    if (assertedAppId && !isValidControlId(assertedAppId)) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        'appId and conversationId must contain only letters, numbers, dot, underscore, or dash',
      );
      return true;
    }
    if (!appId) {
      sendError(res, 403, 'FORBIDDEN', 'API key cannot access this app');
      return true;
    }
    try {
      const result = await ensureSessionForControl(ctx, {
        appId,
        assertedAppId,
        conversationId,
        title: typeof body.title === 'string' ? body.title : null,
        responseMode: body.responseMode,
        webhookId: typeof body.webhookId === 'string' ? body.webhookId : null,
      });
      sendJson(res, 200, {
        sessionId: result.session.sessionId,
        appId: result.session.appId,
        conversationId: result.session.conversationId,
        chatJid: result.session.chatJid,
      });
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  const sessionRoute = parseSessionRoute(pathname);
  if (sessionRoute?.action === 'get' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['sessions:read']);
    if (!auth) return true;
    try {
      const details = await createSessionInteractionModule().getSessionDetails({
        appId: auth.appId,
        sessionId: sessionRoute.sessionId,
      });
      sendJson(res, 200, details);
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (sessionRoute?.action === 'messages' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['sessions:read']);
    if (!auth) return true;
    const limit = parseListLimit(url.searchParams.get('limit'));
    try {
      const result = await createSessionInteractionModule().listMessages({
        appId: auth.appId,
        sessionId: sessionRoute.sessionId,
        limit,
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (sessionRoute?.action === 'runs' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['sessions:read']);
    if (!auth) return true;
    const limit = parseListLimit(url.searchParams.get('limit'));
    try {
      const result = await createSessionInteractionModule().listRuns({
        appId: auth.appId,
        sessionId: sessionRoute.sessionId,
        limit,
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (sessionRoute?.action === 'messages' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'sessions:write',
    ]);
    if (!auth) return true;
    const body = (await readJson(req)) as Record<string, unknown>;
    try {
      const accepted = await acceptMessageForControl(ctx, {
        appId: auth.appId,
        sessionId: sessionRoute.sessionId,
        message: String(body.message || ''),
        senderId: typeof body.senderId === 'string' ? body.senderId : 'sdk',
        senderName:
          typeof body.senderName === 'string' ? body.senderName : 'SDK',
        threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
        correlationId:
          typeof body.correlationId === 'string' ? body.correlationId : null,
        responseMode: body.responseMode,
        webhookId: typeof body.webhookId === 'string' ? body.webhookId : null,
      });
      sendJson(res, 202, {
        accepted: true,
        messageId: accepted.messageId,
        acceptedEventId: accepted.acceptedEventId,
      });
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (sessionRoute?.action === 'events' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['sessions:read']);
    if (!auth) return true;
    const afterEventId = Number(url.searchParams.get('afterEventId') || 0);
    const module = createSessionInteractionModule();
    let events: RuntimeEvent[];
    try {
      events = await module.listEvents({
        appId: auth.appId,
        sessionId: sessionRoute.sessionId,
        afterEventId,
        limit: 100,
      });
    } catch (error) {
      if (sendApplicationError(res, error)) return true;
      throw error;
    }
    if (req.headers.accept?.includes('text/event-stream')) {
      if (ctx.state.activeStreams >= ctx.maxConcurrentStreams) {
        sendError(
          res,
          429,
          'TOO_MANY_STREAMS',
          'Too many active event streams',
        );
        return true;
      }
      const initial = events.length > 0 ? events : [];
      let lastEventId = initial[initial.length - 1]?.eventId;
      let subscription: SessionEventSubscription;
      try {
        subscription = await module.subscribeEvents({
          appId: auth.appId,
          sessionId: sessionRoute.sessionId,
          afterEventId: lastEventId ?? afterEventId,
          limit: 100,
        });
      } catch (error) {
        if (sendApplicationError(res, error)) return true;
        throw error;
      }
      ctx.state.activeStreams += 1;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      for (const event of initial) {
        writeSseEvent(res, event);
      }
      let closed = false;
      const pump = async () => {
        while (!closed) {
          try {
            const next = await subscription.next({ timeoutMs: 30_000 });
            for (const event of next) {
              lastEventId = event.eventId;
              writeSseEvent(res, event);
            }
          } catch (error) {
            logger.warn(
              { err: error, sessionId: sessionRoute.sessionId },
              'Failed streaming runtime events',
            );
            await delay(1000);
          }
        }
      };
      void pump();
      req.on('close', () => {
        closed = true;
        subscription.close();
        ctx.state.activeStreams = Math.max(0, ctx.state.activeStreams - 1);
      });
      return true;
    }
    sendJson(res, 200, {
      events: events.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    });
    return true;
  }

  if (sessionRoute?.action === 'wait' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['sessions:read']);
    if (!auth) return true;
    if (ctx.state.activeWaits >= ctx.maxConcurrentWaits) {
      sendError(res, 429, 'TOO_MANY_WAITS', 'Too many active wait requests');
      return true;
    }
    ctx.state.activeWaits += 1;
    const afterEventId = Number(url.searchParams.get('afterEventId') || 0);
    const timeoutMs = Math.min(
      300_000,
      Math.max(1000, Number(url.searchParams.get('timeoutMs') || 60_000)),
    );
    const startedAt = Date.now();
    try {
      const visible =
        await createSessionInteractionModule().waitForVisibleEvent({
          appId: auth.appId,
          sessionId: sessionRoute.sessionId,
          afterEventId,
          timeoutMs: Math.max(0, timeoutMs - (Date.now() - startedAt)),
        });
      sendJson(res, 200, {
        eventId: visible.eventId,
        eventType: visible.eventType,
        payload: visible.payload,
        createdAt: visible.createdAt,
        afterEventId: visible.eventId,
      });
      return true;
    } catch (error) {
      if (sendApplicationError(res, error)) return true;
      throw error;
    } finally {
      ctx.state.activeWaits = Math.max(0, ctx.state.activeWaits - 1);
    }
  }

  return false;
}

function writeSseEvent(res: ServerResponse, event: RuntimeEvent): void {
  res.write(`id: ${event.eventId}\n`);
  res.write(`event: ${sanitizeSseEventType(event.eventType)}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

function sanitizeSseEventType(eventType: string): string {
  return /^[a-z0-9._-]+$/.test(eventType) ? eventType : 'runtime_event';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseListLimit(raw: string | null): number {
  if (raw === null || raw === '') return 100;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(200, Math.max(1, Math.floor(parsed)));
}
