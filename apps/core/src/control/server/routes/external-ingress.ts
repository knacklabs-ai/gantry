import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApplicationError } from '../../../application/common/application-error.js';
import {
  authorizeControlRequest,
  type ControlRouteContext,
} from '../handler-context.js';
import { readJson, readRawBody, sendError, sendJson } from '../http.js';
import {
  createExternalIngressModule,
  invokeExternalIngressForControl,
} from '../external-ingress-adapter.js';

const MAX_INGRESS_BODY_BYTES = 256 * 1024;

export async function handleExternalIngressRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ControlRouteContext,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/v1/ingresses' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'ingresses:write',
    ]);
    if (!auth) return true;
    const body = (await readJson(req)) as Record<string, unknown>;
    try {
      const created = await createExternalIngressModule(ctx).create({
        appId: auth.appId,
        name: String(body.name || ''),
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        metadata: body.metadata,
      });
      sendJson(res, 201, created);
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (pathname === '/v1/ingresses' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'ingresses:read',
    ]);
    if (!auth) return true;
    sendJson(res, 200, await createExternalIngressModule(ctx).list(auth.appId));
    return true;
  }

  const route = parseIngressRoute(pathname);
  if (!route) return false;

  if (route.action === 'get' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'ingresses:read',
    ]);
    if (!auth) return true;
    try {
      sendJson(
        res,
        200,
        await createExternalIngressModule(ctx).get({
          appId: auth.appId,
          ingressId: route.ingressId,
        }),
      );
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (route.action === 'get' && req.method === 'PATCH') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'ingresses:write',
    ]);
    if (!auth) return true;
    const body = (await readJson(req)) as Record<string, unknown>;
    try {
      sendJson(
        res,
        200,
        await createExternalIngressModule(ctx).update({
          appId: auth.appId,
          ingressId: route.ingressId,
          patch: {
            ...(typeof body.name === 'string' ? { name: body.name } : {}),
            ...(typeof body.enabled === 'boolean'
              ? { enabled: body.enabled }
              : {}),
            ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          },
        }),
      );
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (route.action === 'get' && req.method === 'DELETE') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'ingresses:write',
    ]);
    if (!auth) return true;
    await createExternalIngressModule(ctx).delete({
      appId: auth.appId,
      ingressId: route.ingressId,
    });
    sendJson(res, 200, { deleted: true });
    return true;
  }

  if (route.action === 'rotate' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, [
      'ingresses:write',
    ]);
    if (!auth) return true;
    try {
      sendJson(
        res,
        200,
        await createExternalIngressModule(ctx).rotate({
          appId: auth.appId,
          ingressId: route.ingressId,
        }),
      );
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (route.action === 'invoke' && req.method === 'POST') {
    const rawBody = (await readRawBody(req, MAX_INGRESS_BODY_BYTES)).toString(
      'utf8',
    );
    try {
      const result = await invokeExternalIngressForControl(ctx, {
        ingressId: route.ingressId,
        method: req.method,
        path: pathname,
        timestamp: header(req, 'x-myclaw-ingress-timestamp'),
        nonce: header(req, 'x-myclaw-ingress-nonce'),
        signature: header(req, 'x-myclaw-ingress-signature'),
        rawBody,
      });
      sendJson(res, 202, result);
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (route.action === 'wait' && req.method === 'POST') {
    const rawBody = (await readRawBody(req, MAX_INGRESS_BODY_BYTES)).toString(
      'utf8',
    );
    try {
      const result = await createExternalIngressModule(ctx).signedWait({
        ingressId: route.ingressId,
        method: req.method,
        path: pathname,
        timestamp: header(req, 'x-myclaw-ingress-timestamp'),
        nonce: header(req, 'x-myclaw-ingress-nonce'),
        signature: header(req, 'x-myclaw-ingress-signature'),
        rawBody,
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  return false;
}

function parseIngressRoute(pathname: string): {
  ingressId: string;
  action: 'get' | 'rotate' | 'invoke' | 'wait';
} | null {
  const actionMatch = /^\/v1\/ingresses\/([^/]+)\/(rotate|invoke|wait)$/.exec(
    pathname,
  );
  if (actionMatch) {
    return {
      ingressId: decodeURIComponent(actionMatch[1]!),
      action: actionMatch[2] as 'rotate' | 'invoke' | 'wait',
    };
  }
  const baseMatch = /^\/v1\/ingresses\/([^/]+)$/.exec(pathname);
  if (!baseMatch) return null;
  return { ingressId: decodeURIComponent(baseMatch[1]!), action: 'get' };
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function sendApplicationError(res: ServerResponse, error: unknown): boolean {
  if (!(error instanceof ApplicationError)) return false;
  switch (error.code) {
    case 'NOT_FOUND':
      sendError(res, 404, 'NOT_FOUND', error.message);
      return true;
    case 'FORBIDDEN':
      sendError(res, 403, 'FORBIDDEN', error.message);
      return true;
    case 'INVALID_REQUEST':
      sendError(res, 400, 'INVALID_REQUEST', error.message);
      return true;
    case 'CONFLICT':
      sendError(res, 409, 'CONFLICT', error.message);
      return true;
    case 'RATE_LIMITED':
      sendError(res, 429, 'RATE_LIMITED', error.message);
      return true;
    case 'SCHEDULER_NOT_READY':
      sendError(res, 503, 'SCHEDULER_NOT_READY', error.message);
      return true;
    default:
      throw error;
  }
}
