import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  nowIso,
  nowMs,
  nowMs as currentTimeMs,
  sleep,
} from '../../../shared/time/datetime.js';
import {
  ensurePrivateDirSync,
  writePrivateFileSync,
} from '../../../shared/private-fs.js';
import {
  agentId,
  appId,
  chatJid,
  groupFolder,
  IPC_AUTH_TOKEN,
  IPC_DIR,
  IPC_RESPONSE_KEY_ID,
  MESSAGES_DIR,
  threadId,
  jobId,
} from '../context.js';
import { truncateText } from '../formatting.js';
import {
  buildSignedTaskEnvelope,
  classifyUserQuestionSocketError,
  ensureMcpSocketConnected,
  getMcpSocketClient,
  hasValidIpcResponseSignature,
  writeIpcFile,
} from '../ipc.js';
import { createSignedIpcRequestEnvelope } from '../signing.js';
import { makeIpcId } from '../ipc-ids.js';
import { buildUserQuestionRequestPayload } from './user-question-payload.js';

const USER_QUESTION_TIMEOUT_MS = 5 * 60 * 1000;
const USER_QUESTION_POLL_INTERVAL_MS = 100;
const USER_QUESTION_MAX_ANSWER_LENGTH = 500;
const USER_QUESTION_MAX_ANSWERED_BY_LENGTH = 120;
const INTERACTION_BOUNDARY_WAIT_MS = 2_000;

type UserQuestionToolResult = {
  content: Array<{ type: 'text'; text: string }>;
};

function textResult(text: string): UserQuestionToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Validate a user-question response object (from either the fs response file or
 * a socket `user_question` resp frame) and render it to the tool's text output.
 * The validation (requestId match + ed25519 signature) and the answer → text
 * formatting are byte-identical across transports, so both paths funnel through
 * here. Returns the rendered result, or an error-text result on a mismatch /
 * bad signature / malformed payload.
 */
function formatUserQuestionResponse(
  raw: {
    requestId?: unknown;
    answers?: Record<string, unknown>;
    answeredBy?: unknown;
    signature?: unknown;
  },
  requestId: string,
): UserQuestionToolResult {
  const payload: Record<string, unknown> = {
    requestId,
    answers: raw?.answers && typeof raw.answers === 'object' ? raw.answers : {},
    ...(typeof raw?.answeredBy === 'string' && raw.answeredBy.trim()
      ? { answeredBy: raw.answeredBy }
      : {}),
  };
  if (raw.requestId !== requestId) {
    return textResult('Answer request id mismatch.');
  }
  if (
    !hasValidIpcResponseSignature(
      raw as unknown as Record<string, unknown>,
      payload,
    )
  ) {
    return textResult('Answer verification failed.');
  }
  if (raw?.answers && typeof raw.answers === 'object') {
    const lines: string[] = [];
    for (const [q, answer] of Object.entries(raw.answers)) {
      const normalizedAnswer = Array.isArray(answer)
        ? answer.map((item) => String(item)).join(', ')
        : String(answer);
      lines.push(
        `${q}: ${truncateText(normalizedAnswer, USER_QUESTION_MAX_ANSWER_LENGTH)}`,
      );
    }
    if (typeof raw.answeredBy === 'string' && raw.answeredBy.trim()) {
      lines.push(
        `(answered by ${truncateText(raw.answeredBy.trim(), USER_QUESTION_MAX_ANSWERED_BY_LENGTH)})`,
      );
    }
    return textResult(lines.join('\n') || 'No answer received.');
  }
  return textResult('No answer received.');
}

async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!signal) {
    await sleep(ms);
    return false;
  }
  if (signal.aborted) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestUserInteractionBoundary(
  requestId: string,
  signal?: AbortSignal,
): Promise<void> {
  const boundaryDir = path.join(IPC_DIR, 'interaction-boundaries');
  ensurePrivateDirSync(boundaryDir);
  const boundaryPath = path.join(boundaryDir, `${requestId}.json`);
  const tmpPath = `${boundaryPath}.tmp`;
  writePrivateFileSync(
    tmpPath,
    JSON.stringify(
      {
        type: 'user_interaction',
        requestId,
        tool: 'ask_user_question',
        timestamp: nowIso(),
      },
      null,
      2,
    ),
  );
  fs.renameSync(tmpPath, boundaryPath);

  const deadline = nowMs() + INTERACTION_BOUNDARY_WAIT_MS;
  while (nowMs() < deadline) {
    if (!fs.existsSync(boundaryPath)) return;
    const aborted = await sleepWithAbort(
      USER_QUESTION_POLL_INTERVAL_MS,
      signal,
    );
    if (aborted) return;
  }
}

export function registerMessagingTools(server: McpServer): void {
  server.tool(
    'send_message',
    "Send a message to the user or group immediately while you're still running. Use this for live progress updates or to send multiple messages. In scheduled jobs, the scheduler sends the completion notification, so do not use this for job results.",
    {
      text: z.string().describe('The message text to send'),
      sender: z
        .string()
        .optional()
        .describe(
          'Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.',
        ),
    },
    async (
      args,
      _context?: {
        signal?: AbortSignal;
      },
    ) => {
      if (jobId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Scheduled job message suppressed. The scheduler will send one completion notification when the job finishes.',
            },
          ],
        };
      }
      const data: Record<string, string | undefined> = {
        type: 'message',
        chatJid,
        text: args.text,
        sender: args.sender || undefined,
        groupFolder,
        timestamp: nowIso(),
      };

      // Socket/dual mode: deliver the message as a fire-and-forget `message`
      // frame over the same mcp-role connection, reusing the byte-identical
      // signed envelope the fs path would write. The host re-verifies it the
      // same way whether it arrived as a file or a frame. If the socket is not
      // usable we fall back to the durable fs write — messages are
      // fire-and-forget and must never block on a flaky socket.
      const client = getMcpSocketClient();
      if (client) {
        const connected = await ensureMcpSocketConnected(client);
        if (connected) {
          const signed = buildSignedTaskEnvelope(data);
          client.send('message', signed);
          return {
            content: [{ type: 'text' as const, text: 'Message sent.' }],
          };
        }
        // connect failed → fs fallback below.
      }

      writeIpcFile(MESSAGES_DIR, data);

      return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
    },
  );

  server.tool(
    'ask_user_question',
    'Ask the user a structured multiple-choice question. Shows interactive buttons in Telegram. Use when you need the user to pick between discrete options (e.g. which database, which approach, which config). Returns the selected option(s).',
    {
      questions: z
        .array(
          z.object({
            question: z
              .string()
              .describe('The question to ask (must end with ?)'),
            header: z
              .string()
              .max(12)
              .describe(
                'Short label displayed as tag, e.g. "Deploy", "Config"',
              ),
            options: z
              .array(
                z.object({
                  label: z.string().describe('Option text (1-5 words)'),
                  description: z.string().describe('What this option means'),
                }),
              )
              .min(2)
              .max(4),
            multiSelect: z
              .boolean()
              .default(false)
              .describe('Allow selecting multiple options'),
          }),
        )
        .min(1)
        .max(4),
    },
    async (
      args,
      context?: {
        signal?: AbortSignal;
      },
    ) => {
      const userQuestionRequestsDir = path.join(IPC_DIR, 'user-questions');
      const userQuestionResponsesDir = path.join(IPC_DIR, 'user-answers');
      ensurePrivateDirSync(userQuestionRequestsDir);
      ensurePrivateDirSync(userQuestionResponsesDir);

      const requestId = makeIpcId('userq');
      const requestPath = path.join(
        userQuestionRequestsDir,
        `${requestId}.json`,
      );
      const responsePath = path.join(
        userQuestionResponsesDir,
        `${requestId}.json`,
      );
      const tmpPath = `${requestPath}.tmp`;

      await requestUserInteractionBoundary(requestId, context?.signal);

      const payload = buildUserQuestionRequestPayload({
        requestId,
        sourceAgentFolder: groupFolder,
        // Stamp the asking conversation's jid so the host routes the question to
        // THIS customer, not a first-match-by-folder fallback (cross-conversation
        // bleed prevention — mirrors how send_message stamps chatJid).
        targetJid: chatJid,
        questions: args.questions,
        appId,
        agentId,
        threadId,
        responseKeyId: IPC_RESPONSE_KEY_ID,
        nowMs: currentTimeMs(),
        timeoutMs: USER_QUESTION_TIMEOUT_MS,
      });
      const envelope = createSignedIpcRequestEnvelope(IPC_AUTH_TOKEN, payload);

      // Socket/dual mode: route the question over the same mcp-role connection,
      // reusing the byte-identical signed envelope. The resp frame carries the
      // verified UserQuestionResponse, which we render exactly as the fs path
      // would. A socket timeout maps to the same "timed out" outcome; any
      // transient transport failure falls back to the durable fs write+poll
      // below so a flaky socket never drops a question fs would have answered.
      const client = getMcpSocketClient();
      if (client) {
        if (context?.signal?.aborted) {
          return textResult(
            'Question cancelled before an answer was received.',
          );
        }
        const connected = await ensureMcpSocketConnected(client);
        if (connected) {
          try {
            const resp = await client.request('user_question', envelope, {
              id: requestId,
              timeoutMs: USER_QUESTION_TIMEOUT_MS,
            });
            return formatUserQuestionResponse(
              resp as {
                requestId?: unknown;
                answers?: Record<string, unknown>;
                answeredBy?: unknown;
                signature?: unknown;
              },
              requestId,
            );
          } catch (err) {
            const disposition = classifyUserQuestionSocketError(err);
            if (disposition.kind === 'timeout') {
              return textResult(
                'Question timed out — no answer received within 5 minutes.',
              );
            }
            // 'fallback' → fall through to the durable fs mailbox below.
          }
        }
        // connect failed or transient request failure → fs fallback.
      }

      writePrivateFileSync(tmpPath, JSON.stringify(envelope, null, 2));
      fs.renameSync(tmpPath, requestPath);

      const deadline = nowMs() + USER_QUESTION_TIMEOUT_MS;
      while (nowMs() < deadline) {
        if (context?.signal?.aborted) {
          fs.rmSync(requestPath, { force: true });
          return textResult(
            'Question cancelled before an answer was received.',
          );
        }
        if (fs.existsSync(responsePath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(responsePath, 'utf-8')) as {
              requestId?: unknown;
              answers?: Record<string, unknown>;
              answeredBy?: unknown;
              signature?: unknown;
            };
            fs.unlinkSync(responsePath);
            return formatUserQuestionResponse(raw, requestId);
          } catch {
            return textResult('Failed to read answer.');
          }
        }
        const aborted = await sleepWithAbort(
          USER_QUESTION_POLL_INTERVAL_MS,
          context?.signal,
        );
        if (aborted) {
          fs.rmSync(requestPath, { force: true });
          return textResult(
            'Question cancelled before an answer was received.',
          );
        }
      }
      fs.rmSync(requestPath, { force: true });
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Question timed out — no answer received within 5 minutes.',
          },
        ],
      };
    },
  );
}
