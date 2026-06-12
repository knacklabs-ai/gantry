import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Spawns the real DeepAgents (LangChain) runner against a local fake model
// gateway that returns canned OpenAI chat-completions SSE. No real network: the
// runner only ever talks to the loopback fake gateway via the projected
// OPENAI_BASE_URL/OPENAI_API_KEY gateway env. Asserts the runner frame contract,
// env hygiene (only the run-scoped gateway token reaches upstream), and the
// adapter-private session persistence.

const RUNNER_ENTRY = path.resolve(
  __dirname,
  '../../src/adapters/llm/deepagents-langchain/runner/index.ts',
);
const TSX_BIN = path.resolve(__dirname, '../../../../node_modules/.bin/tsx');

// A self-contained stub Gantry facade MCP stdio server (plain Node, no TS) that
// the runner can spawn via `node <path>`. Exposes the baseline tools the runner
// projects so MultiServerMCPClient connects and the run can stream. When
// FORCE_TOOL is set it lets a forced tool_call be handled by the gantry tool.
function writeStubGantryMcpServer(filePath: string): void {
  const src = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'gantry', version: '0.0.0-test' });
const names = JSON.parse(process.env.GANTRY_MCP_TOOL_NAMES_JSON || '[]');
for (const name of names) {
  server.registerTool(
    name,
    { description: name + ' (stub)', inputSchema: { text: z.string().optional() } },
    async () => ({ content: [{ type: 'text', text: name + ' ok' }] }),
  );
}
const transport = new StdioServerTransport();
await server.connect(transport);
`;
  fs.writeFileSync(filePath, src);
}

// A self-contained stub third-party MCP stdio server exposing one tool, used to
// prove the third-party permission gate writes a host permission-request file.
function writeStubThirdPartyMcpServer(filePath: string): void {
  const src = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'notion', version: '0.0.0-test' });
server.registerTool(
  'mcp__notion__search',
  { description: 'search notion (stub)', inputSchema: { query: z.string() } },
  async () => ({ content: [{ type: 'text', text: 'searched' }] }),
);
const transport = new StdioServerTransport();
await server.connect(transport);
`;
  fs.writeFileSync(filePath, src);
}

interface ParsedFrame {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  usage?: { inputTokens: number; outputTokens: number; model?: string };
  contextUsage?: { maxTokens: number; totalTokens: number };
  error?: string;
}

function parseFrames(stdout: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  const re = /---GANTRY_OUTPUT_START---\n([\s\S]*?)\n---GANTRY_OUTPUT_END---/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stdout)) !== null) {
    frames.push(JSON.parse(match[1].trim()) as ParsedFrame);
  }
  return frames;
}

interface FakeGateway {
  baseUrl: string;
  requests: Array<{ authorization?: string; body: string; path: string }>;
  close: () => Promise<void>;
}

async function startFakeOpenAiGateway(): Promise<FakeGateway> {
  const requests: FakeGateway['requests'] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({
        authorization: req.headers.authorization,
        body,
        path: req.url ?? '',
      });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const id = 'chatcmpl-integration';
      const chunks = [
        {
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Hello' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            { index: 0, delta: { content: ' Gantry' }, finish_reason: null },
          ],
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 },
        },
      ];
      for (const chunk of chunks) {
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'gpt-5.5', ...chunk })}\n\n`,
        );
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fake gateway did not bind a port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/openai`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

// Gateway that forces the model to call the third-party tool on the first turn,
// then returns a plain text answer once it has seen the tool result. Used to
// drive the third-party MCP permission gate end to end.
async function startToolForcingOpenAiGateway(): Promise<FakeGateway> {
  const requests: FakeGateway['requests'] = [];
  let turn = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({
        authorization: req.headers.authorization,
        body,
        path: req.url ?? '',
      });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const id = 'chatcmpl-tool';
      const firstTurn = turn === 0;
      turn += 1;
      const chunks = firstTurn
        ? [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'mcp__notion__search',
                          arguments: '{"query":"roadmap"}',
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            },
          ]
        : [
            {
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: 'Done.' },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 2,
                total_tokens: 22,
              },
            },
          ];
      for (const chunk of chunks) {
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'gpt-5.5', ...chunk })}\n\n`,
        );
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('tool-forcing gateway did not bind a port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/openai`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

interface TempRoot {
  root: string;
  sessionsDir: string;
  inputDir: string;
  ipcDir: string;
  workspaceIpcDir: string;
  gantryServerPath: string;
  thirdPartyServerPath: string;
  mcpConfigPath: string;
}

function runRunner(input: {
  stdin: Record<string, unknown>;
  temp: TempRoot;
  baseUrl: string;
  apiKey: string;
  extraEnv?: Record<string, string>;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [RUNNER_ENTRY], {
      env: {
        ...process.env,
        GANTRY_DEEPAGENTS_MODEL_ID: 'gpt-5.5',
        GANTRY_DEEPAGENTS_SESSIONS_DIR: input.temp.sessionsDir,
        GANTRY_IPC_INPUT_DIR: input.temp.inputDir,
        // Common host env (agent-spawn projects these for every runner). The
        // runner spawns the Gantry facade MCP stdio server with this path and
        // wires its IPC env block.
        GANTRY_MCP_SERVER_PATH: input.temp.gantryServerPath,
        GANTRY_IPC_DIR: input.temp.ipcDir,
        GANTRY_IPC_AUTH_TOKEN: 'ipc-auth',
        GANTRY_IPC_RESPONSE_VERIFY_KEY: '',
        GANTRY_IPC_RESPONSE_KEY_ID: 'key-id',
        GANTRY_APP_ID: 'default',
        GANTRY_AGENT_ID: 'agent:main_agent',
        GANTRY_CHAT_JID: String(input.stdin.chatJid ?? 'tg:group'),
        GANTRY_WORKSPACE_KEY: String(input.stdin.workspaceFolder ?? 'group'),
        GANTRY_MEMORY_DEFAULT_SCOPE: 'group',
        GANTRY_INTERACTIVE_PERMISSION_TIMEOUT_MS: '1500',
        GANTRY_PERMISSION_TIMEOUT_MS: '1500',
        ...input.extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(
      JSON.stringify({
        ...input.stdin,
        modelCredentialEnv: {
          OPENAI_BASE_URL: input.baseUrl,
          OPENAI_API_KEY: input.apiKey,
        },
      }),
    );
    child.stdin.end();
  });
}

const tempRoots: string[] = [];
// Stub MCP servers must resolve @modelcontextprotocol/sdk from the repo
// node_modules, so the temp tree lives under the repo (not os.tmpdir()).
const REPO_TMP_BASE = path.resolve(__dirname, '../.tmp-deepagents-int');

function makeTempRoot(): TempRoot {
  fs.mkdirSync(REPO_TMP_BASE, { recursive: true });
  const root = fs.mkdtempSync(path.join(REPO_TMP_BASE, 'run-'));
  tempRoots.push(root);
  const sessionsDir = path.join(root, 'sessions');
  const inputDir = path.join(root, 'ipc-input');
  const ipcDir = path.join(root, 'ipc');
  const workspaceFolder = 'group';
  const workspaceIpcDir = path.join(ipcDir, workspaceFolder);
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(workspaceIpcDir, { recursive: true });
  const gantryServerPath = path.join(root, 'gantry-mcp.mjs');
  const thirdPartyServerPath = path.join(root, 'notion-mcp.mjs');
  const mcpConfigPath = path.join(root, 'mcp-config.json');
  writeStubGantryMcpServer(gantryServerPath);
  writeStubThirdPartyMcpServer(thirdPartyServerPath);
  return {
    root,
    sessionsDir,
    inputDir,
    ipcDir,
    workspaceIpcDir,
    gantryServerPath,
    thirdPartyServerPath,
    mcpConfigPath,
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  fs.rmSync(REPO_TMP_BASE, { recursive: true, force: true });
});

describe('DeepAgents (LangChain) runner boundary integration', () => {
  it('streams runner frames from a gateway-backed OpenAI run and persists the session', async () => {
    const gateway = await startFakeOpenAiGateway();
    const temp = makeTempRoot();
    const sessionsDir = temp.sessionsDir;
    try {
      const result = await runRunner({
        stdin: {
          prompt: 'say hello',
          workspaceFolder: 'group',
          chatJid: 'tg:group',
        },
        temp,
        baseUrl: gateway.baseUrl,
        apiKey: 'gtw_integrationtoken',
      });

      expect(result.code).toBe(0);
      const frames = parseFrames(result.stdout);

      // First frame carries the session id immediately for durable persistence.
      expect(frames[0]).toMatchObject({ status: 'success', result: null });
      const sessionId = frames[0].newSessionId;
      expect(sessionId).toBeTruthy();
      expect(frames.every((frame) => frame.newSessionId === sessionId)).toBe(
        true,
      );

      // Text deltas stream through, then a final usage/context frame.
      const textDeltas = frames
        .map((frame) => frame.result)
        .filter((value): value is string => typeof value === 'string');
      expect(textDeltas.join('')).toBe('Hello Gantry');

      const usageFrame = frames.find((frame) => frame.usage);
      expect(usageFrame?.usage).toMatchObject({
        model: 'gpt-5.5',
        inputTokens: 42,
        outputTokens: 5,
      });
      // Context window is reported at runtime from the LangChain model profile,
      // not from the catalog (deepagents entries omit contextWindowTokens).
      expect(usageFrame?.contextUsage?.maxTokens).toBeGreaterThan(0);

      // Env hygiene: only the run-scoped gateway token reaches the upstream.
      expect(gateway.requests.length).toBeGreaterThan(0);
      // The OpenAI SDK appends /chat/completions to the projected gateway
      // baseUrl (.../openai); the real Gantry gateway maps that to
      // api.openai.com/v1/chat/completions (proven in the gateway unit test).
      for (const request of gateway.requests) {
        expect(request.authorization).toBe('Bearer gtw_integrationtoken');
        expect(request.path).toContain('/openai/chat/completions');
        expect(request.body).not.toContain('gtw_');
      }

      // Adapter-private session projection is persisted for live resume.
      const sessionFiles = fs.readdirSync(sessionsDir);
      expect(sessionFiles).toContain(`${sessionId}.json`);
      const persisted = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf-8'),
      ) as { version: number; messages: Array<{ role: string; text: string }> };
      expect(persisted.version).toBe(1);
      expect(persisted.messages.at(-1)).toEqual({
        role: 'ai',
        text: 'Hello Gantry',
      });
    } finally {
      await gateway.close();
    }
  }, 60_000);

  it('throws a stale-session error when resuming an unknown session id', async () => {
    const gateway = await startFakeOpenAiGateway();
    const temp = makeTempRoot();
    try {
      const result = await runRunner({
        stdin: {
          prompt: 'resume please',
          workspaceFolder: 'group',
          chatJid: 'tg:group',
          sessionId: 'missing-session-id',
        },
        temp,
        baseUrl: gateway.baseUrl,
        apiKey: 'gtw_integrationtoken',
      });

      expect(result.code).toBe(1);
      const frames = parseFrames(result.stdout);
      const errorFrame = frames.find((frame) => frame.status === 'error');
      expect(errorFrame?.error).toContain(
        'No DeepAgents session found with session ID',
      );
      // No upstream call should happen for a missing session.
      expect(gateway.requests.length).toBe(0);
    } finally {
      await gateway.close();
    }
  }, 60_000);

  it('runs an ephemeral scheduled job without persisting a session file', async () => {
    const gateway = await startFakeOpenAiGateway();
    const temp = makeTempRoot();
    try {
      const result = await runRunner({
        stdin: {
          prompt: 'do the job',
          workspaceFolder: 'group',
          chatJid: 'tg:group',
          isScheduledJob: true,
          jobId: 'job-1',
          runId: 'run-1',
        },
        temp,
        baseUrl: gateway.baseUrl,
        apiKey: 'gtw_integrationtoken',
      });

      expect(result.code).toBe(0);
      const frames = parseFrames(result.stdout);
      expect(frames.some((frame) => frame.usage)).toBe(true);
      // Scheduled jobs are ephemeral: no session file is written.
      expect(fs.readdirSync(temp.sessionsDir)).toEqual([]);
    } finally {
      await gateway.close();
    }
  }, 60_000);

  it('gates a third-party MCP tool call and writes a durable permission-request file (HITL durability)', async () => {
    // A gateway that forces the model to call the third-party tool on the first
    // turn, then (after the tool result) returns a final assistant message.
    const gateway = await startToolForcingOpenAiGateway();
    const temp = makeTempRoot();
    fs.writeFileSync(
      temp.mcpConfigPath,
      JSON.stringify({
        notion: {
          command: process.execPath,
          args: [temp.thirdPartyServerPath],
        },
      }),
    );
    const requestDir = path.join(temp.workspaceIpcDir, 'permission-requests');
    try {
      const result = await runRunner({
        stdin: {
          prompt: 'search notion for the roadmap',
          workspaceFolder: 'group',
          chatJid: 'tg:group',
          // No rule allows mcp__notion__search -> the gate must prompt the host.
          allowedTools: [],
        },
        temp,
        baseUrl: gateway.baseUrl,
        apiKey: 'gtw_integrationtoken',
        extraEnv: {
          GANTRY_MCP_CONFIG_FILE: temp.mcpConfigPath,
          // Short interactive timeout so the unattended test resolves the
          // pending request as a denial without an approver.
          GANTRY_INTERACTIVE_PERMISSION_TIMEOUT_MS: '1200',
          GANTRY_PERMISSION_TIMEOUT_MS: '1200',
        },
      });

      // The gate wrote the signed permission-request file the host turns into a
      // durable pending_interactions row BEFORE any approval renders.
      expect(fs.existsSync(requestDir)).toBe(true);
      const files = fs
        .readdirSync(requestDir)
        .filter((file) => file.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(1);
      const request = JSON.parse(
        fs.readFileSync(path.join(requestDir, files[0]), 'utf-8'),
      ) as { toolName: string; sourceAgentFolder: string; signature?: string };
      expect(request.toolName).toBe('mcp__notion__search');
      expect(request.sourceAgentFolder).toBe('group');
      expect(typeof request.signature).toBe('string');
      // The runner does not crash; it streams a terminal frame after the gate
      // denies (timeout) and the model produces its final answer.
      expect(result.code).toBe(0);
    } finally {
      await gateway.close();
    }
  }, 60_000);
});
