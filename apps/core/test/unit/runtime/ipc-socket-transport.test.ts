import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// processTaskIpc is mocked so the test controls exactly what the task handler
// does (it normally fans out to the real scheduler/admin handlers). In the
// success path the mock calls the REAL writeTaskIpcResponse, exercising the
// response-router → signed-resp-frame path end to end.
vi.mock('@core/jobs/ipc-handler.js', () => ({
  processTaskIpc: vi.fn(),
}));

import { processTaskIpc } from '@core/jobs/ipc-handler.js';
import { writeTaskIpcResponse } from '@core/jobs/ipc-shared.js';
import {
  startIpcSocketServer,
  type IpcSocketServerHandle,
} from '@core/runtime/ipc-socket-server.js';
import type { IpcDeps } from '@core/runtime/ipc-domain-types.js';
import type { ConversationRoute } from '@core/domain/types.js';
import { createIpcAuthEnvelope } from '@core/runtime/ipc-auth.js';
import { createSignedIpcRequestEnvelope } from '@core/runner/mcp/signing.js';
import { verifyIpcResponsePayload } from '@core/infrastructure/ipc/response-signing.js';
import { encodeFrame, FrameDecoder } from '@core/shared/ipc-frame.js';
import {
  encodeWireFrame,
  parseWireFrame,
  type IpcWireFrame,
  type IpcWireChannel,
} from '@core/shared/ipc-wire.js';
import { clearIpcResponders } from '@core/runtime/ipc-response-router.js';
import { clearConsumedIpcRequestIds } from '@core/runtime/ipc-auth-validation.js';
import { clearIpcRateLimitState } from '@core/runtime/ipc-rate-limit.js';

const processTaskIpcMock = vi.mocked(processTaskIpc);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FOLDER = 'group-test';
const OTHER_FOLDER = 'group-other';
const CHAT_JID = 'wa:1555000@test';
const THREAD_ID = 'thread-abc';

function buildDeps(overrides: Partial<IpcDeps> = {}): IpcDeps {
  const routes: Record<string, ConversationRoute> = {
    [CHAT_JID]: {
      name: 'Test Group',
      folder: FOLDER,
      trigger: '',
      added_at: new Date().toISOString(),
    },
  };
  const deps = {
    sendMessage: vi.fn(async () => undefined),
    conversationRoutes: () => routes,
    registerGroup: vi.fn(),
    syncGroups: vi.fn(async () => undefined),
    getAvailableGroups: vi.fn(() => []),
    writeGroupsSnapshot: vi.fn(),
    onSchedulerChanged: vi.fn(),
    requestPermissionApproval: vi.fn(async () => ({}) as never),
    requestUserAnswer: vi.fn(async () => ({}) as never),
    opsRepository: {} as never,
    ...overrides,
  } as unknown as IpcDeps;
  return deps;
}

// ---------------------------------------------------------------------------
// Fake worker client — real net.connect, framed wire protocol, promise-based
// frame reads.
// ---------------------------------------------------------------------------

class FakeWorkerClient {
  private readonly socket: net.Socket;
  private readonly decoder = new FrameDecoder();
  private readonly inbound: IpcWireFrame[] = [];
  private waiters: Array<(frame: IpcWireFrame) => void> = [];
  private closed = false;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      let bodies: Buffer[];
      try {
        bodies = this.decoder.push(chunk);
      } catch {
        return;
      }
      for (const body of bodies) {
        let frame: IpcWireFrame;
        try {
          frame = parseWireFrame(body.toString('utf8'));
        } catch {
          continue;
        }
        // Auto-answer server heartbeat pings so the connection stays alive.
        if (frame.type === 'ctrl' && frame.ctrl === 'ping') {
          this.sendRaw({
            v: 1,
            type: 'ctrl',
            channel: null,
            ctrl: 'pong',
            id: frame.id,
            payload: {},
          });
          continue;
        }
        const waiter = this.waiters.shift();
        if (waiter) waiter(frame);
        else this.inbound.push(frame);
      }
    });
    socket.on('close', () => {
      this.closed = true;
    });
    socket.on('error', () => {
      this.closed = true;
    });
  }

  static connect(socketPath: string): Promise<FakeWorkerClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath);
      const onErr = (err: Error) => reject(err);
      socket.once('error', onErr);
      socket.once('connect', () => {
        socket.removeListener('error', onErr);
        resolve(new FakeWorkerClient(socket));
      });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  sendRaw(frame: IpcWireFrame): void {
    const body = Buffer.from(encodeWireFrame(frame), 'utf8');
    this.socket.write(encodeFrame(body));
  }

  /** Send a raw (non-frame-encoded) buffer to corrupt the wire. */
  sendBytes(buf: Buffer): void {
    this.socket.write(buf);
  }

  sendHello(signedPayload: Record<string, unknown>, id = 'hello-1'): void {
    this.sendRaw({
      v: 1,
      type: 'ctrl',
      channel: null,
      ctrl: 'hello',
      id,
      payload: signedPayload,
    });
  }

  sendReq(
    channel: IpcWireChannel,
    signedPayload: Record<string, unknown>,
    id: string,
  ): void {
    this.sendRaw({ v: 1, type: 'req', channel, id, payload: signedPayload });
  }

  /** Resolve with the next inbound frame (FIFO with the buffer). */
  nextFrame(timeoutMs = 5000): Promise<IpcWireFrame> {
    const buffered = this.inbound.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== onFrame);
        reject(new Error('nextFrame timeout'));
      }, timeoutMs);
      const onFrame = (frame: IpcWireFrame) => {
        clearTimeout(timer);
        resolve(frame);
      };
      this.waiters.push(onFrame);
    });
  }

  /** Wait for a resp/ctrl frame whose id matches; skips non-matching frames. */
  async waitForId(id: string, timeoutMs = 5000): Promise<IpcWireFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`waitForId(${id}) timeout`);
      const frame = await this.nextFrame(remaining);
      if (frame.id === id) return frame;
    }
  }

  /** Resolve once the socket closes (server-side destroy). */
  waitClose(timeoutMs = 5000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('waitClose timeout')),
        timeoutMs,
      );
      this.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  destroy(): void {
    this.socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Envelope builders (shared auth context across hello + task payloads)
// ---------------------------------------------------------------------------

function makeAuth(folder: string, threadId: string | undefined) {
  return createIpcAuthEnvelope(folder, threadId);
}

function buildHelloPayload(
  authToken: string,
  opts: {
    folder: string;
    role?: 'runner' | 'mcp';
    threadId?: string;
    runHandle?: string;
    expiresAt?: string;
  },
): Record<string, unknown> {
  return createSignedIpcRequestEnvelope(authToken, {
    kind: 'hello',
    role: opts.role ?? 'runner',
    runHandle: opts.runHandle ?? 'run-1',
    folder: opts.folder,
    context: { threadId: opts.threadId ?? null },
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  });
}

function buildTaskPayload(
  authToken: string,
  responseKeyId: string,
  opts: { taskId: string; type: string; threadId?: string },
): Record<string, unknown> {
  return createSignedIpcRequestEnvelope(authToken, {
    type: opts.type,
    taskId: opts.taskId,
    context: {
      threadId: opts.threadId ?? null,
      responseKeyId,
    },
  });
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;
let server: IpcSocketServerHandle | undefined;
const clients: FakeWorkerClient[] = [];

function socketPathFor(name = 'core.sock'): string {
  return path.join(tmpDir, name);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-socket-transport-'));
  processTaskIpcMock.mockReset();
  clearIpcResponders();
  clearConsumedIpcRequestIds();
  clearIpcRateLimitState();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  if (server) {
    await server.stop().catch(() => undefined);
    server = undefined;
  }
  clearIpcResponders();
  clearConsumedIpcRequestIds();
  clearIpcRateLimitState();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function startServer(
  deps: IpcDeps,
  opts: Parameters<typeof startIpcSocketServer>[1] = {},
): Promise<IpcSocketServerHandle> {
  const handle = await startIpcSocketServer(deps, {
    socketPath: socketPathFor(),
    ...opts,
  });
  if (!handle) throw new Error('server failed to start');
  server = handle;
  return handle;
}

async function connect(
  handle: IpcSocketServerHandle,
): Promise<FakeWorkerClient> {
  const client = await FakeWorkerClient.connect(handle.socketPath);
  clients.push(client);
  return client;
}

// ---------------------------------------------------------------------------
// 1. Handshake success
// ---------------------------------------------------------------------------

describe('ipc-socket-server handshake', () => {
  it('1. accepts a valid hello and replies ctrl:welcome', async () => {
    const handle = await startServer(buildDeps());
    const client = await connect(handle);
    const auth = makeAuth(FOLDER, THREAD_ID);
    client.sendHello(
      buildHelloPayload(auth.authToken, {
        folder: FOLDER,
        threadId: THREAD_ID,
      }),
      'hello-1',
    );

    const welcome = await client.waitForId('hello-1');
    expect(welcome.type).toBe('ctrl');
    expect(welcome.ctrl).toBe('welcome');
    expect(handle.connectionsForFolder(FOLDER).length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 2. Handshake failures
  // -------------------------------------------------------------------------

  it('2a. rejects a hello signed with the wrong token (forged signature)', async () => {
    const handle = await startServer(buildDeps());
    const client = await connect(handle);
    // Sign with a token derived from a DIFFERENT folder → signature mismatch.
    const wrongAuth = makeAuth('group-evil', THREAD_ID);
    client.sendHello(
      buildHelloPayload(wrongAuth.authToken, {
        folder: FOLDER,
        threadId: THREAD_ID,
      }),
    );

    await client.waitClose();
    expect(client.isClosed).toBe(true);
    expect(handle.connectionsForFolder(FOLDER).length).toBe(0);
  });

  it('2b. rejects a hello for an unregistered folder', async () => {
    const handle = await startServer(buildDeps());
    const client = await connect(handle);
    const auth = makeAuth(OTHER_FOLDER, THREAD_ID);
    client.sendHello(
      buildHelloPayload(auth.authToken, {
        folder: OTHER_FOLDER,
        threadId: THREAD_ID,
      }),
    );

    await client.waitClose();
    expect(client.isClosed).toBe(true);
  });

  it('2c. rejects an expired hello', async () => {
    const handle = await startServer(buildDeps());
    const client = await connect(handle);
    const auth = makeAuth(FOLDER, THREAD_ID);
    const past = new Date(Date.now() - 60_000).toISOString();
    client.sendHello(
      buildHelloPayload(auth.authToken, {
        folder: FOLDER,
        threadId: THREAD_ID,
        expiresAt: past,
      }),
    );

    await client.waitClose();
    expect(client.isClosed).toBe(true);
  });

  it('2d. closes when the first frame is not a hello', async () => {
    const handle = await startServer(buildDeps());
    const client = await connect(handle);
    const auth = makeAuth(FOLDER, THREAD_ID);
    // A task req before any handshake.
    client.sendReq(
      'task',
      buildTaskPayload(auth.authToken, auth.responseKeyId, {
        taskId: 'task-1',
        type: 'scheduler_list_jobs',
        threadId: THREAD_ID,
      }),
      'r1',
    );

    await client.waitClose();
    expect(client.isClosed).toBe(true);
  });

  it('2e. closes a handshakeless connection after the handshake timeout', async () => {
    const handle = await startServer(buildDeps(), { handshakeTimeoutMs: 150 });
    const client = await connect(handle);
    // Send nothing — the timeout should fire.
    await client.waitClose(3000);
    expect(client.isClosed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3-7. Task dispatch
// ---------------------------------------------------------------------------

describe('ipc-socket-server task dispatch', () => {
  async function handshake(
    handle: IpcSocketServerHandle,
    auth: ReturnType<typeof makeAuth>,
    threadId = THREAD_ID,
  ): Promise<FakeWorkerClient> {
    const client = await connect(handle);
    client.sendHello(
      buildHelloPayload(auth.authToken, { folder: FOLDER, threadId }),
      'hs',
    );
    const welcome = await client.waitForId('hs');
    expect(welcome.ctrl).toBe('welcome');
    return client;
  }

  it('3. task req → signed resp frame (router + ed25519 end to end)', async () => {
    // The mocked handler emulates a real handler: it calls writeTaskIpcResponse,
    // which finds the registered responder and delivers a signed payload.
    processTaskIpcMock.mockImplementation(async (data) => {
      writeTaskIpcResponse(
        FOLDER,
        data.taskId,
        { ok: true, message: 'done' },
        data.authThreadId,
        data.responseKeyId,
      );
    });

    const handle = await startServer(buildDeps());
    const auth = makeAuth(FOLDER, THREAD_ID);
    const client = await handshake(handle, auth);

    client.sendReq(
      'task',
      buildTaskPayload(auth.authToken, auth.responseKeyId, {
        taskId: 'task-7',
        type: 'scheduler_list_jobs',
        threadId: THREAD_ID,
      }),
      'req-7',
    );

    const resp = await client.waitForId('req-7');
    expect(resp.type).toBe('resp');
    expect(resp.channel).toBe('task');
    const { signature, ...payloadWithoutSig } = resp.payload as {
      signature?: string;
    } & Record<string, unknown>;
    expect(typeof signature).toBe('string');
    expect(
      verifyIpcResponsePayload(
        auth.responseVerifyKey,
        payloadWithoutSig,
        signature,
      ),
    ).toBe(true);
    expect(payloadWithoutSig.ok).toBe(true);
    expect(payloadWithoutSig.message).toBe('done');
    expect(processTaskIpcMock).toHaveBeenCalledTimes(1);
  });

  it('4. forged task req (wrong token) → transport-error resp, connection survives', async () => {
    const handle = await startServer(buildDeps());
    const auth = makeAuth(FOLDER, THREAD_ID);
    const client = await handshake(handle, auth);

    // Sign the task with a token for a different folder → parseTaskIpcData throws.
    const wrongAuth = makeAuth('group-evil', THREAD_ID);
    client.sendReq(
      'task',
      buildTaskPayload(wrongAuth.authToken, auth.responseKeyId, {
        taskId: 'task-bad',
        type: 'scheduler_list_jobs',
        threadId: THREAD_ID,
      }),
      'req-bad',
    );

    const resp = await client.waitForId('req-bad');
    expect(resp.type).toBe('resp');
    expect((resp.payload as { ok?: boolean }).ok).toBe(false);
    expect(processTaskIpcMock).not.toHaveBeenCalled();
    expect(client.isClosed).toBe(false);

    // Connection still usable: a valid req now gets a response.
    processTaskIpcMock.mockImplementation(async (data) => {
      writeTaskIpcResponse(
        FOLDER,
        data.taskId,
        { ok: true, message: 'ok2' },
        data.authThreadId,
        data.responseKeyId,
      );
    });
    client.sendReq(
      'task',
      buildTaskPayload(auth.authToken, auth.responseKeyId, {
        taskId: 'task-ok',
        type: 'scheduler_list_jobs',
        threadId: THREAD_ID,
      }),
      'req-ok',
    );
    const ok = await client.waitForId('req-ok');
    expect((ok.payload as { ok?: boolean }).ok).toBe(true);
  });

  it('5. replay of the same task req is rejected the second time', async () => {
    let handlerCalls = 0;
    processTaskIpcMock.mockImplementation(async (data) => {
      handlerCalls += 1;
      writeTaskIpcResponse(
        FOLDER,
        data.taskId,
        { ok: true, message: 'first' },
        data.authThreadId,
        data.responseKeyId,
      );
    });

    const handle = await startServer(buildDeps());
    const auth = makeAuth(FOLDER, THREAD_ID);
    const client = await handshake(handle, auth);

    const payload = buildTaskPayload(auth.authToken, auth.responseKeyId, {
      taskId: 'task-replay',
      type: 'scheduler_list_jobs',
      threadId: THREAD_ID,
    });

    client.sendReq('task', payload, 'req-first');
    const first = await client.waitForId('req-first');
    expect((first.payload as { ok?: boolean }).ok).toBe(true);

    // Re-send the byte-identical payload under a new frame id → replay reject.
    client.sendReq('task', payload, 'req-second');
    const second = await client.waitForId('req-second');
    expect((second.payload as { ok?: boolean }).ok).toBe(false);
    // Handler ran exactly once (the replay never reached it).
    expect(handlerCalls).toBe(1);
  });

  it('6. unsupported channel → {ok:false, unsupported_channel}, connection survives', async () => {
    const handle = await startServer(buildDeps());
    const auth = makeAuth(FOLDER, THREAD_ID);
    const client = await handshake(handle, auth);

    client.sendReq(
      'memory',
      buildTaskPayload(auth.authToken, auth.responseKeyId, {
        taskId: 'm1',
        type: 'noop',
        threadId: THREAD_ID,
      }),
      'req-mem',
    );

    const resp = await client.waitForId('req-mem');
    expect(resp.type).toBe('resp');
    expect((resp.payload as { ok?: boolean }).ok).toBe(false);
    expect((resp.payload as { code?: string }).code).toBe(
      'unsupported_channel',
    );
    expect(client.isClosed).toBe(false);
  });

  it('7. rate limit → a rate_limited resp appears, connection survives', async () => {
    // Exhaust the 300/60s limiter for this (folder,'tasks') bucket so the very
    // next task req is rejected at the transport layer without ever reaching
    // parseTaskIpcData.
    const { canProcessIpcFile } =
      await import('@core/runtime/ipc-rate-limit.js');
    for (let i = 0; i < 300; i += 1) canProcessIpcFile(FOLDER, 'tasks');

    const handle = await startServer(buildDeps());
    const auth = makeAuth(FOLDER, THREAD_ID);
    const client = await handshake(handle, auth);

    client.sendReq(
      'task',
      buildTaskPayload(auth.authToken, auth.responseKeyId, {
        taskId: 'task-rl',
        type: 'scheduler_list_jobs',
        threadId: THREAD_ID,
      }),
      'req-rl',
    );

    const resp = await client.waitForId('req-rl');
    expect(resp.type).toBe('resp');
    expect((resp.payload as { ok?: boolean }).ok).toBe(false);
    expect((resp.payload as { code?: string }).code).toBe('rate_limited');
    expect(processTaskIpcMock).not.toHaveBeenCalled();
    expect(client.isClosed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Bad/malformed frame → connection closes, server survives
// ---------------------------------------------------------------------------

describe('ipc-socket-server resilience', () => {
  it('8. a malformed wire frame closes that connection but the server survives', async () => {
    const handle = await startServer(buildDeps());
    const bad = await connect(handle);
    // Frame header says 5 bytes, body is invalid JSON "{{{{{".
    const body = Buffer.from('{{{{{', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    bad.sendBytes(Buffer.concat([header, body]));

    await bad.waitClose();
    expect(bad.isClosed).toBe(true);

    // A SECOND client can still connect and complete the handshake.
    const good = await connect(handle);
    const auth = makeAuth(FOLDER, THREAD_ID);
    good.sendHello(
      buildHelloPayload(auth.authToken, {
        folder: FOLDER,
        threadId: THREAD_ID,
      }),
      'hs2',
    );
    const welcome = await good.waitForId('hs2');
    expect(welcome.ctrl).toBe('welcome');
  });
});

// ---------------------------------------------------------------------------
// 9. Single-instance election + clean shutdown
// ---------------------------------------------------------------------------

describe('ipc-socket-server single-instance', () => {
  it('9. a second start on the same socket returns undefined; cleanup leaves no files', async () => {
    const deps = buildDeps();
    const first = await startServer(deps);

    const second = await startIpcSocketServer(deps, {
      socketPath: socketPathFor(),
    });
    expect(second).toBeUndefined();

    // Stop the live owner → socket + owner files are removed.
    await first.stop();
    server = undefined;
    expect(fs.existsSync(socketPathFor())).toBe(false);
    expect(fs.existsSync(`${socketPathFor()}.owner`)).toBe(false);
  });
});
