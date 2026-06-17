import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIpcResponseSigningKeyPair } from '@core/infrastructure/ipc/response-signing.js';
import { signIpcResponsePayload } from '@core/infrastructure/ipc/response-signing.js';

describe('browser MCP IPC response signatures', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-browser-ipc-'));
    tempRoots.push(root);
    return root;
  }

  function stubRunnerEnv(root = tempRoot()): void {
    vi.stubEnv('GANTRY_IPC_DIR', path.join(root, 'main_agent'));
    vi.stubEnv('GANTRY_GROUP_FOLDER', 'main_agent');
    vi.stubEnv('GANTRY_CHAT_JID', 'tg:test');
    vi.stubEnv('GANTRY_ADMIN_MCP_TOOLS_JSON', '[]');
  }

  it('accepts signed responses when only the response verify key is configured', async () => {
    const root = tempRoot();
    const ipcDir = path.join(root, 'main_agent');
    const keys = createIpcResponseSigningKeyPair();
    vi.stubEnv('GANTRY_IPC_DIR', ipcDir);
    vi.stubEnv('GANTRY_IPC_RESPONSE_VERIFY_KEY', keys.publicKeyPem);
    vi.stubEnv('GANTRY_GROUP_FOLDER', 'main_agent');
    vi.stubEnv('GANTRY_CHAT_JID', 'tg:test');
    vi.stubEnv('GANTRY_ADMIN_MCP_TOOLS_JSON', '[]');

    const { hasValidIpcResponseSignature } =
      await import('@core/runner/mcp/ipc.js');
    const payload = { ok: true, requestId: 'browser-1' };
    const signature = signIpcResponsePayload(keys.privateKeyPem, payload);

    expect(
      hasValidIpcResponseSignature({ ...payload, signature }, payload),
    ).toBe(true);
  });

  it('rejects tampered response payloads', async () => {
    const keys = createIpcResponseSigningKeyPair();
    stubRunnerEnv();
    vi.stubEnv('GANTRY_IPC_RESPONSE_VERIFY_KEY', keys.publicKeyPem);
    const { hasValidIpcResponseSignature } =
      await import('@core/runner/mcp/ipc.js');
    const signedPayload = { ok: true, requestId: 'browser-1' };
    const signature = signIpcResponsePayload(keys.privateKeyPem, signedPayload);
    const tamperedPayload = {
      ok: true,
      requestId: 'browser-1',
      data: { running: true },
    };

    expect(
      hasValidIpcResponseSignature(
        { ...tamperedPayload, signature },
        tamperedPayload,
      ),
    ).toBe(false);
  });

  it('rejects missing signatures, wrong keys, and unset verify keys', async () => {
    const keys = createIpcResponseSigningKeyPair();
    const wrongKeys = createIpcResponseSigningKeyPair();
    const payload = { ok: true, requestId: 'browser-1' };
    const signature = signIpcResponsePayload(keys.privateKeyPem, payload);

    stubRunnerEnv();
    vi.stubEnv('GANTRY_IPC_RESPONSE_VERIFY_KEY', keys.publicKeyPem);
    let ipc = await import('@core/runner/mcp/ipc.js');
    expect(ipc.hasValidIpcResponseSignature(payload, payload)).toBe(false);

    vi.resetModules();
    stubRunnerEnv();
    vi.stubEnv('GANTRY_IPC_RESPONSE_VERIFY_KEY', wrongKeys.publicKeyPem);
    ipc = await import('@core/runner/mcp/ipc.js');
    expect(
      ipc.hasValidIpcResponseSignature({ ...payload, signature }, payload),
    ).toBe(false);

    vi.resetModules();
    vi.unstubAllEnvs();
    stubRunnerEnv();
    ipc = await import('@core/runner/mcp/ipc.js');
    expect(
      ipc.hasValidIpcResponseSignature({ ...payload, signature }, payload),
    ).toBe(false);
  });
});
