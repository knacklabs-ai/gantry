import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '@core/adapters/llm/anthropic-claude-agent/runner/ipc-signing.js',
  async () => {
    const actual = await vi.importActual<
      typeof import('@core/adapters/llm/anthropic-claude-agent/runner/ipc-signing.js')
    >('@core/adapters/llm/anthropic-claude-agent/runner/ipc-signing.js');
    return {
      ...actual,
      hasValidIpcResponseSignature: vi.fn(() => true),
    };
  },
);

async function waitForFiles(dir: string, count: number): Promise<string[]> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((file) => file.endsWith('.json'))
      : [];
    if (files.length >= count) return files.sort();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .sort()
    : [];
}

describe('requestPermissionApproval', () => {
  let tempDir: string;
  let oldEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetModules();
    oldEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-permission-'));
    process.env.GANTRY_WORKSPACE_GROUP_DIR = path.join(tempDir, 'workspace');
    process.env.GANTRY_WORKSPACE_EXTRA_DIR = path.join(tempDir, 'extra');
    process.env.GANTRY_IPC_DIR = path.join(tempDir, 'ipc');
    process.env.GANTRY_IPC_INPUT_DIR = path.join(tempDir, 'input');
    process.env.GANTRY_IPC_RESPONSE_VERIFY_KEY = 'test-key';
    process.env.GANTRY_IPC_RESPONSE_KEY_ID = 'test-response-key';
    process.env.GANTRY_AGENT_RUN_HANDLE = 'run-handle-1';
  });

  afterEach(() => {
    process.env = oldEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shares one timed-grant approval across identical concurrent same-run permission requests', async () => {
    const { requestPermissionApproval } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/permission-callback.js');

    const first = requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      threadId: 'topic-1',
      toolName: 'Bash',
      toolInput: { command: 'find ~/persona -type f' },
    });
    const second = requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      threadId: 'topic-2',
      toolName: 'Bash',
      toolInput: { command: 'find ~/persona -type f' },
    });

    const requestDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-requests',
    );
    const requestFiles = await waitForFiles(requestDir, 1);
    expect(requestFiles).toHaveLength(1);
    const request = JSON.parse(
      fs.readFileSync(path.join(requestDir, requestFiles[0]), 'utf-8'),
    ) as { requestId: string; responseNonce: string };

    const responseDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-responses',
    );
    fs.mkdirSync(responseDir, { recursive: true });
    fs.writeFileSync(
      path.join(responseDir, `${request.requestId}.json`),
      JSON.stringify({
        requestId: request.requestId,
        responseNonce: request.responseNonce,
        approved: true,
        mode: 'allow_timed_grant',
        decidedBy: 'Ravi',
        timedGrantExpiresAtMs: Date.now() + 60_000,
        signature: 'test-signature',
      }),
    );

    const [firstDecision, secondDecision] = await Promise.all([first, second]);
    expect(firstDecision.mode).toBe('allow_timed_grant');
    expect(secondDecision.mode).toBe('allow_timed_grant');
    expect(
      fs.readdirSync(requestDir).filter((file) => file.endsWith('.json')),
    ).toHaveLength(1);
  });

  it('does not reuse a denial for a different requested tool in the same run', async () => {
    const { requestPermissionApproval } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/permission-callback.js');

    const first = requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      toolName: 'Bash',
      toolInput: { command: 'find ~/persona -type f' },
    });

    const requestDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-requests',
    );
    const firstRequestFiles = await waitForFiles(requestDir, 1);
    expect(firstRequestFiles).toHaveLength(1);
    const firstRequest = JSON.parse(
      fs.readFileSync(path.join(requestDir, firstRequestFiles[0]), 'utf-8'),
    ) as {
      requestId: string;
      responseNonce: string;
      payload?: { toolName?: string };
      toolName?: string;
    };

    const responseDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-responses',
    );
    fs.mkdirSync(responseDir, { recursive: true });
    fs.writeFileSync(
      path.join(responseDir, `${firstRequest.requestId}.json`),
      JSON.stringify({
        requestId: firstRequest.requestId,
        responseNonce: firstRequest.responseNonce,
        approved: false,
        mode: 'cancel',
        decidedBy: 'Ravi',
        reason: 'denied bash',
        signature: 'test-signature',
      }),
    );

    const firstDecision = await first;
    expect(firstDecision.approved).toBe(false);

    const second = requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      toolName: 'Browser',
      toolInput: { url: 'https://example.com' },
    });
    const secondRequestFiles = await waitForFiles(requestDir, 2);
    expect(secondRequestFiles).toHaveLength(2);
    const secondRequestFile = secondRequestFiles.find(
      (file) => file !== firstRequestFiles[0],
    );
    expect(secondRequestFile).toBeDefined();
    const secondRequest = JSON.parse(
      fs.readFileSync(path.join(requestDir, secondRequestFile!), 'utf-8'),
    ) as {
      requestId: string;
      responseNonce: string;
      payload?: { toolName?: string };
      toolName?: string;
    };
    expect(secondRequest.payload?.toolName ?? secondRequest.toolName).toBe(
      'Browser',
    );
    fs.writeFileSync(
      path.join(responseDir, `${secondRequest.requestId}.json`),
      JSON.stringify({
        requestId: secondRequest.requestId,
        responseNonce: secondRequest.responseNonce,
        approved: true,
        mode: 'allow_once',
        decidedBy: 'Ravi',
        reason: 'approved',
        signature: 'test-signature',
      }),
    );

    const secondDecision = await second;
    expect(secondDecision.approved).toBe(true);
    expect(secondDecision.mode).toBe('allow_once');
  });
});

// ---------------------------------------------------------------------------
// Socket fast-path (Pillar 1, Phase 5.3d)
//
// When the run's runner socket client (published via setActiveRunnerSocketClient)
// is connected, requestPermissionApproval sends the SAME signed envelope over
// that ONE runner connection and maps the verified signed decision — writing NO
// permission-request file. A transient socket failure falls back to the durable
// fs write+poll so permission never hangs / hard-fails on a socket hiccup.
// hasValidIpcResponseSignature is mocked to true (the transport-level signature
// is exercised by the socket-server test); this isolates the callback's branch.
// ---------------------------------------------------------------------------

describe('requestPermissionApproval socket fast-path', () => {
  let tempDir: string;
  let oldEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetModules();
    oldEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-permission-sock-'));
    process.env.GANTRY_WORKSPACE_GROUP_DIR = path.join(tempDir, 'workspace');
    process.env.GANTRY_WORKSPACE_EXTRA_DIR = path.join(tempDir, 'extra');
    process.env.GANTRY_IPC_DIR = path.join(tempDir, 'ipc');
    process.env.GANTRY_IPC_INPUT_DIR = path.join(tempDir, 'input');
    process.env.GANTRY_IPC_RESPONSE_VERIFY_KEY = 'test-key';
    process.env.GANTRY_IPC_RESPONSE_KEY_ID = 'test-response-key';
    process.env.GANTRY_AGENT_RUN_HANDLE = 'run-handle-1';
    // Socket/dual transport so the socket branch is eligible (the callback also
    // gates on the active client being connected).
    process.env.GANTRY_IPC_TRANSPORT = 'socket';
    process.env.GANTRY_IPC_SOCKET_PATH = path.join(tempDir, 'core.sock');
  });

  afterEach(() => {
    process.env = oldEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('sends the permission request over the connected runner socket and writes no request file', async () => {
    const { setActiveRunnerSocketClient } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/active-runner-socket.js');
    const { requestPermissionApproval } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/permission-callback.js');

    const sent: Array<{
      channel: string;
      payload: Record<string, unknown>;
      id?: string;
    }> = [];
    const fakeClient = {
      connected: true,
      request: vi.fn(
        async (
          channel: 'permission',
          payload: Record<string, unknown>,
          opts?: { id?: string; timeoutMs?: number },
        ) => {
          sent.push({ channel, payload, id: opts?.id });
          // Echo a signed decision keyed to the request's id + responseNonce.
          const requestId = String(opts?.id);
          return {
            requestId,
            responseNonce: payload.responseNonce,
            approved: true,
            mode: 'allow_once',
            decidedBy: 'Ravi',
            reason: 'looks fine',
            signature: 'sig-from-host',
          } as Record<string, unknown>;
        },
      ),
    };
    setActiveRunnerSocketClient(fakeClient);

    const decision = await requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    expect(decision.approved).toBe(true);
    expect(decision.mode).toBe('allow_once');
    expect(decision.decidedBy).toBe('Ravi');

    // The request went over the socket exactly once on the `permission` channel,
    // and the correlation id matches the signed envelope's requestId.
    expect(fakeClient.request).toHaveBeenCalledTimes(1);
    expect(sent[0].channel).toBe('permission');
    expect(sent[0].payload.requestId).toBe(sent[0].id);
    expect(String(sent[0].id)).toMatch(/^perm-/);

    // Pure-socket: NO permission-request file was written to the fs mailbox.
    const requestDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-requests',
    );
    const requestFiles = fs.existsSync(requestDir)
      ? fs.readdirSync(requestDir).filter((f) => f.endsWith('.json'))
      : [];
    expect(requestFiles).toHaveLength(0);
  });

  it('falls back to the fs write+poll when the socket request fails (transient)', async () => {
    const { setActiveRunnerSocketClient } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/active-runner-socket.js');
    const { requestPermissionApproval } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/permission-callback.js');

    const fakeClient = {
      connected: true,
      request: vi.fn(async () => {
        throw new Error('connection lost: socket_error');
      }),
    };
    setActiveRunnerSocketClient(fakeClient);

    const pending = requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    // The socket was attempted, then the durable fs request file is written.
    const requestDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-requests',
    );
    const requestFiles = await waitForFiles(requestDir, 1);
    expect(requestFiles).toHaveLength(1);
    expect(fakeClient.request).toHaveBeenCalledTimes(1);

    const request = JSON.parse(
      fs.readFileSync(path.join(requestDir, requestFiles[0]), 'utf-8'),
    ) as { requestId: string; responseNonce: string };

    // Resolve via the fs response path (the host watcher's writer).
    const responseDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-responses',
    );
    fs.mkdirSync(responseDir, { recursive: true });
    fs.writeFileSync(
      path.join(responseDir, `${request.requestId}.json`),
      JSON.stringify({
        requestId: request.requestId,
        responseNonce: request.responseNonce,
        approved: true,
        mode: 'allow_once',
        decidedBy: 'Ravi',
        signature: 'test-signature',
      }),
    );

    const decision = await pending;
    expect(decision.approved).toBe(true);
    expect(decision.mode).toBe('allow_once');
  });

  it('takes the fs path (no socket request) when the active client is not connected', async () => {
    const { setActiveRunnerSocketClient } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/active-runner-socket.js');
    const { requestPermissionApproval } =
      await import('@core/adapters/llm/anthropic-claude-agent/runner/permission-callback.js');

    const fakeClient = {
      connected: false,
      request: vi.fn(async () => ({}) as Record<string, unknown>),
    };
    setActiveRunnerSocketClient(fakeClient);

    const pending = requestPermissionApproval({
      appId: 'default',
      agentId: 'agent:main_agent',
      groupFolder: 'main_agent',
      targetJid: 'tg:test',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    const requestDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-requests',
    );
    const requestFiles = await waitForFiles(requestDir, 1);
    expect(requestFiles).toHaveLength(1);
    // Not connected → the socket request is never attempted.
    expect(fakeClient.request).not.toHaveBeenCalled();

    const request = JSON.parse(
      fs.readFileSync(path.join(requestDir, requestFiles[0]), 'utf-8'),
    ) as { requestId: string; responseNonce: string };
    const responseDir = path.join(
      tempDir,
      'ipc',
      'main_agent',
      'permission-responses',
    );
    fs.mkdirSync(responseDir, { recursive: true });
    fs.writeFileSync(
      path.join(responseDir, `${request.requestId}.json`),
      JSON.stringify({
        requestId: request.requestId,
        responseNonce: request.responseNonce,
        approved: false,
        mode: 'cancel',
        signature: 'test-signature',
      }),
    );

    const decision = await pending;
    expect(decision.approved).toBe(false);
  });
});
