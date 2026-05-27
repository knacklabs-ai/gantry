import type { IncomingMessage, ServerResponse } from 'node:http';

import { ModelCredentialService } from '../../../application/model-credentials/model-credential-service.js';
import { getRuntimeStorage } from '../../../adapters/storage/postgres/runtime-store.js';
import type { AppId } from '../../../domain/app/app.js';
import {
  listSupportedModelCredentialProviders,
  normalizeModelCredentialProvider,
} from '../../../domain/model-credentials/model-credentials.js';
import {
  authorizeControlRequest,
  type ControlRouteContext,
} from '../handler-context.js';
import { readJson, sendError, sendJson } from '../http.js';

function modelCredentialService(): ModelCredentialService {
  const storage = getRuntimeStorage();
  return new ModelCredentialService(
    storage.repositories.modelCredentials,
    (event) => storage.runtimeEvents.publish(event),
  );
}

export async function handleCredentialRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ControlRouteContext,
  pathname: string,
): Promise<boolean> {
  if (
    pathname !== '/v1/credentials/models' &&
    !pathname.startsWith('/v1/credentials/models/')
  ) {
    return false;
  }

  const auth = authorizeControlRequest(req, res, ctx.keys, ['agents:admin']);
  if (!auth) return true;
  const appId = auth.appId as AppId;

  if (pathname === '/v1/credentials/models') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      return true;
    }
    sendJson(res, 200, {
      providers: await modelCredentialService().list({ appId }),
    });
    return true;
  }

  const parts = pathname.split('/').filter(Boolean);
  if (
    parts.length !== 4 ||
    parts[0] !== 'v1' ||
    parts[1] !== 'credentials' ||
    parts[2] !== 'models'
  ) {
    sendError(res, 404, 'NOT_FOUND', 'Model credential route not found.');
    return true;
  }
  const providerId = parts[3] || '';
  let normalizedProvider: ReturnType<typeof normalizeModelCredentialProvider>;
  try {
    normalizedProvider = normalizeModelCredentialProvider(providerId);
  } catch (error) {
    sendError(
      res,
      400,
      'INVALID_PROVIDER',
      error instanceof Error ? error.message : 'Invalid provider',
      { supported: listSupportedModelCredentialProviders() },
    );
    return true;
  }

  if (req.method === 'PUT') {
    const rawBody = await readJson(req);
    if (
      typeof rawBody !== 'object' ||
      rawBody === null ||
      Array.isArray(rawBody)
    ) {
      sendError(res, 400, 'INVALID_REQUEST', 'Request body must be JSON.');
      return true;
    }
    const payload = (rawBody as { payload?: unknown }).payload;
    const authMode = (rawBody as { authMode?: unknown }).authMode;
    const unknown = unknownKeys(rawBody as Record<string, unknown>, [
      'authMode',
      'payload',
    ]);
    if (unknown.length > 0) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        `Unsupported request field(s): ${unknown.join(', ')}.`,
      );
      return true;
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      sendError(res, 400, 'INVALID_REQUEST', 'payload is required.');
      return true;
    }
    if (
      authMode !== undefined &&
      (typeof authMode !== 'string' || !authMode.trim())
    ) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        'authMode must be a non-empty string.',
      );
      return true;
    }
    try {
      const service = modelCredentialService();
      await service.set({
        appId,
        providerId: normalizedProvider,
        ...(authMode ? { authMode: authMode.trim() } : {}),
        payload,
        actor: `control-api:${auth.kid}`,
      });
      sendJson(
        res,
        200,
        await redactedProviderStatus(service, appId, normalizedProvider),
      );
    } catch (error) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid credential request.',
      );
    }
    return true;
  }

  if (req.method === 'PATCH') {
    const rawBody = await readJson(req);
    if (
      typeof rawBody !== 'object' ||
      rawBody === null ||
      Array.isArray(rawBody)
    ) {
      sendError(res, 400, 'INVALID_REQUEST', 'Request body must be JSON.');
      return true;
    }
    const unknown = unknownKeys(rawBody as Record<string, unknown>, [
      'authMode',
      'payload',
    ]);
    if (unknown.length > 0) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        `Unsupported request field(s): ${unknown.join(', ')}.`,
      );
      return true;
    }
    if (Object.hasOwn(rawBody, 'authMode')) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        'PATCH cannot change credential authMode. Use PUT to replace the credential.',
      );
      return true;
    }
    const payload = (rawBody as { payload?: unknown }).payload;
    try {
      const service = modelCredentialService();
      await service.rotate({
        appId,
        providerId: normalizedProvider,
        payload,
        actor: `control-api:${auth.kid}`,
      });
      sendJson(
        res,
        200,
        await redactedProviderStatus(service, appId, normalizedProvider),
      );
    } catch (error) {
      sendError(
        res,
        400,
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid credential request.',
      );
    }
    return true;
  }

  if (req.method === 'DELETE') {
    const service = modelCredentialService();
    await service.disable({
      appId,
      providerId: normalizedProvider,
      actor: `control-api:${auth.kid}`,
    });
    sendJson(
      res,
      200,
      await redactedProviderStatus(service, appId, normalizedProvider),
    );
    return true;
  }

  res.setHeader('Allow', 'PUT, PATCH, DELETE');
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  return true;
}

function unknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(raw)
    .filter((key) => !allowedSet.has(key))
    .sort();
}

async function redactedProviderStatus(
  service: ModelCredentialService,
  appId: AppId,
  providerId: ReturnType<typeof normalizeModelCredentialProvider>,
) {
  const row = (await service.list({ appId })).find(
    (item) => item.providerId === providerId,
  );
  if (!row) {
    throw new Error(
      `Model credential provider ${providerId} is not supported.`,
    );
  }
  return row;
}
