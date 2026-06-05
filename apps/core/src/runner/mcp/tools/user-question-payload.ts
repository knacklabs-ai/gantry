// Pure builder for the ask_user_question IPC request payload. Kept free of the
// env-coupled runner context so it is unit-testable. The host (ipc.ts) routes the
// question to `targetJid`; omitting it makes the host fall back to a first-match-
// by-folder lookup, which under concurrent customers of one agent would deliver the
// question to the wrong one.
export interface UserQuestionPayloadInput {
  requestId: string;
  sourceAgentFolder: string;
  targetJid: string;
  questions: unknown;
  appId?: string;
  agentId?: string;
  threadId?: string;
  responseKeyId?: string;
  nowMs: number;
  timeoutMs: number;
}

// Returns a plain string-keyed map (the payload is signed + serialized, so it is
// intentionally loose) rather than a named interface, which would not be assignable
// to the signing helper's Record<string, unknown> parameter.
export function buildUserQuestionRequestPayload(
  input: UserQuestionPayloadInput,
): Record<string, unknown> {
  return {
    requestId: input.requestId,
    sourceAgentFolder: input.sourceAgentFolder,
    ...(input.targetJid ? { targetJid: input.targetJid } : {}),
    questions: input.questions,
    context: {
      ...(input.appId ? { appId: input.appId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.responseKeyId ? { responseKeyId: input.responseKeyId } : {}),
    },
    timestamp: new Date(input.nowMs).toISOString(),
    expiresAt: new Date(input.nowMs + input.timeoutMs).toISOString(),
  };
}
