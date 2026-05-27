import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlRouteContext } from '@core/control/server/handler-context.js';
import type {
  ModelCredential,
  ModelCredentialMetadata,
  ModelCredentialProvider,
} from '@core/domain/model-credentials/model-credentials.js';
import type { ModelCredentialRepository } from '@core/domain/ports/repositories.js';

const rows = vi.hoisted(() => new Map<string, ModelCredential>());
const publishedEvents = vi.hoisted(() => [] as unknown[]);

vi.mock('@core/adapters/storage/postgres/runtime-store.js', () => ({
  getRuntimeStorage: () => ({
    repositories: {
      modelCredentials: modelCredentialsRepository,
    },
    runtimeEvents: {
      publish: async (event: unknown) => {
        publishedEvents.push(event);
      },
    },
  }),
}));

import { handleCredentialRoutes } from '@core/control/server/routes/credentials.js';

const modelCredentialsRepository: ModelCredentialRepository = {
  async getModelCredential(input) {
    return rows.get(rowKey(input.appId, input.providerId)) ?? null;
  },
  async listModelCredentials(input) {
    return [...rows.values()]
      .filter((row) => row.appId === input.appId)
      .map(({ payload: _payload, ...metadata }) => metadata);
  },
  async upsertModelCredential(input) {
    const now = new Date().toISOString();
    const key = rowKey(input.appId, input.providerId);
    const existing = rows.get(key);
    const row: ModelCredential = {
      id: existing?.id ?? (`model-credential:${key}` as never),
      appId: input.appId,
      providerId: input.providerId,
      authMode: input.authMode,
      status: 'active',
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      fingerprint: input.fingerprint,
      fieldFingerprints: input.fieldFingerprints,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    rows.set(key, row);
    const { payload: _payload, ...metadata } = row;
    return metadata;
  },
  async disableModelCredential(input) {
    const key = rowKey(input.appId, input.providerId);
    const existing = rows.get(key);
    if (!existing) return null;
    const row = {
      ...existing,
      status: 'disabled' as const,
      updatedAt: new Date().toISOString(),
    };
    rows.set(key, row);
    const { payload: _payload, ...metadata } = row;
    return metadata;
  },
};

type TestResponse = ServerResponse & {
  body: string;
  headers: Record<string, string>;
};

beforeEach(() => {
  rows.clear();
  publishedEvents.length = 0;
});

describe('credential control routes', () => {
  it('stores model credentials and returns only redacted provider status', async () => {
    const res = await invokeCredentialRoute(
      'PUT',
      '/v1/credentials/models/anthropic',
      {
        payload: { apiKey: 'sk-ant-route' },
      },
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      providerId: 'anthropic',
      authMode: 'api_key',
      configured: true,
      health: 'ready',
      configuredFields: ['apiKey'],
    });
    expect(JSON.stringify(body)).not.toContain('sk-ant-route');
  });

  it('rejects unknown write fields before storing credentials', async () => {
    const res = await invokeCredentialRoute(
      'PUT',
      '/v1/credentials/models/anthropic',
      {
        payload: { apiKey: 'sk-ant-route' },
        apiKey: 'sk-ant-route',
      },
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain(
      'Unsupported request field(s): apiKey',
    );
    expect(rows.has('default:anthropic')).toBe(false);
  });

  it('rejects PATCH authMode changes', async () => {
    seedCredential({
      appId: 'default' as never,
      providerId: 'anthropic',
      authMode: 'api_key',
    });

    const res = await invokeCredentialRoute(
      'PATCH',
      '/v1/credentials/models/anthropic',
      {
        authMode: 'api_key',
        payload: { apiKey: 'sk-ant-new' },
      },
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain(
      'PATCH cannot change credential authMode',
    );
  });

  it('rotates existing credential fields and keeps responses redacted', async () => {
    seedCredential({
      appId: 'default' as never,
      providerId: 'anthropic',
      authMode: 'api_key',
    });

    const res = await invokeCredentialRoute(
      'PATCH',
      '/v1/credentials/models/anthropic',
      {
        payload: { apiKey: 'sk-ant-new' },
      },
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      providerId: 'anthropic',
      authMode: 'api_key',
      configured: true,
      health: 'ready',
    });
    expect(JSON.stringify(body)).not.toContain('sk-ant-new');
    expect(rows.get('default:anthropic')?.payload).toEqual({
      apiKey: 'sk-ant-new',
    });
  });

  it('soft-disables credentials and returns the redacted disabled status', async () => {
    seedCredential({
      appId: 'default' as never,
      providerId: 'anthropic',
      authMode: 'api_key',
    });

    const res = await invokeCredentialRoute(
      'DELETE',
      '/v1/credentials/models/anthropic',
      undefined,
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      providerId: 'anthropic',
      authMode: 'api_key',
      configured: false,
      health: 'disabled',
      status: 'disabled',
    });
    expect(rows.get('default:anthropic')?.payload).toEqual({
      apiKey: 'sk-ant-old',
    });
  });
});

async function invokeCredentialRoute(
  method: string,
  pathname: string,
  body: unknown,
): Promise<TestResponse> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []) as IncomingMessage;
  req.method = method;
  req.headers = {
    authorization: 'Bearer test-token',
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(raw).toString(),
  };
  const res = responseRecorder();
  await handleCredentialRoutes(req, res, mockContext(), pathname);
  return res;
}

function responseRecorder(): TestResponse {
  return {
    statusCode: 0,
    body: '',
    headers: {},
    setHeader(name: string, value: number | string | string[]) {
      this.headers[name.toLowerCase()] = Array.isArray(value)
        ? value.join(', ')
        : String(value);
      return this;
    },
    end(chunk?: unknown) {
      this.body += chunk ? String(chunk) : '';
      return this;
    },
  } as TestResponse;
}

function mockContext(): ControlRouteContext {
  return {
    app: {} as ControlRouteContext['app'],
    runtimeHome: '/tmp/gantry-test',
    keys: [
      {
        kid: 'test',
        tokenHash: createHash('sha256').update('test-token').digest(),
        scopes: new Set(['agents:admin']),
        appId: 'default',
      },
    ],
    socketPath: '/tmp/gantry-control.sock',
    port: 8787,
    maxConcurrentStreams: 25,
    maxConcurrentWaits: 50,
    maxConcurrentTriggerWaits: 50,
    state: { activeStreams: 0, activeWaits: 0, activeTriggerWaits: 0 },
    triggerRateLimiter: { consume: () => true },
    getRuntimeSettings: () =>
      ({}) as ReturnType<ControlRouteContext['getRuntimeSettings']>,
    getDefaultModelConfig: () => ({ source: 'test' }),
    getModelDefaults: () =>
      ({ defaults: {} }) as ReturnType<ControlRouteContext['getModelDefaults']>,
    patchModelDefaults: () => ({ ok: true }),
    preflightModelPreset: async () => ({
      ok: true,
      status: 'pass',
      message: 'ok',
    }),
    syncSettingsFromProjection: async () => undefined,
  };
}

function seedCredential(input: {
  appId: ModelCredentialMetadata['appId'];
  providerId: ModelCredentialProvider;
  authMode: string;
}): void {
  rows.set(rowKey(input.appId, input.providerId), {
    id: `model-credential:${input.appId}:${input.providerId}` as never,
    appId: input.appId,
    providerId: input.providerId,
    authMode: input.authMode,
    status: 'active',
    schemaVersion: 1,
    payload: { apiKey: 'sk-ant-old' },
    fingerprint: 'sha256:old',
    fieldFingerprints: [{ field: 'apiKey', fingerprint: 'sha256:old-field' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function rowKey(appId: string, providerId: string): string {
  return `${appId}:${providerId}`;
}
