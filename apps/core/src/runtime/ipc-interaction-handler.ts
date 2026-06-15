import fs from 'fs';
import path from 'path';

import {
  PermissionApprovalDecision,
  PermissionApprovalRequest,
  UserQuestionRequest,
  UserQuestionResponse,
} from '../domain/types.js';
import { signIpcResponsePayload } from '../infrastructure/ipc/response-signing.js';
import { takeIpcResponder } from './ipc-response-router.js';
import {
  ensurePrivateDirSync,
  protectOwnerReadonlyFileSync,
  writePrivateFileSync,
} from '../shared/private-fs.js';
import { IpcDeps } from './ipc-domain-types.js';

export async function processPermissionIpcRequest(
  request: PermissionApprovalRequest,
  deps: Pick<IpcDeps, 'requestPermissionApproval'>,
): Promise<PermissionApprovalDecision> {
  return deps.requestPermissionApproval(request);
}

export async function processUserQuestionIpcRequest(
  request: UserQuestionRequest,
  deps: Pick<IpcDeps, 'requestUserAnswer'>,
): Promise<UserQuestionResponse> {
  return deps.requestUserAnswer(request);
}

function toTrimmedString(
  value: unknown,
  opts: { maxLen?: number } = {},
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (opts.maxLen && trimmed.length > opts.maxLen) return undefined;
  return trimmed;
}

function protectTerminalResponseFile(filePath: string): void {
  try {
    protectOwnerReadonlyFileSync(filePath);
  } catch {
    // Best effort hardening only.
  }
}

function withSignature(
  privateKeyPem: string | undefined,
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const signature = signIpcResponsePayload(privateKeyPem, payload);
  if (!signature) return null;
  return { ...payload, signature };
}

export function writePermissionIpcResponse(
  ipcBaseDir: string,
  sourceAgentFolder: string,
  decision: PermissionApprovalDecision & {
    requestId: string;
    responseNonce?: string;
  },
  privateKeyPem?: string,
): void {
  const responseDir = path.join(
    ipcBaseDir,
    sourceAgentFolder,
    'permission-responses',
  );
  ensurePrivateDirSync(responseDir);
  const responsePath = path.join(responseDir, `${decision.requestId}.json`);
  if (fs.existsSync(responsePath)) return;
  const tmpPath = `${responsePath}.tmp`;
  const payload = withSignature(privateKeyPem, {
    requestId: decision.requestId,
    ...(decision.responseNonce
      ? { responseNonce: decision.responseNonce }
      : {}),
    approved: decision.approved,
    ...(decision.mode ? { mode: decision.mode } : {}),
    ...(decision.decidedBy ? { decidedBy: decision.decidedBy } : {}),
    ...(decision.reason ? { reason: decision.reason } : {}),
    ...(decision.updatedPermissions
      ? { updatedPermissions: decision.updatedPermissions }
      : {}),
    ...(decision.decisionClassification
      ? { decisionClassification: decision.decisionClassification }
      : {}),
    ...(typeof decision.timedGrantExpiresAtMs === 'number'
      ? { timedGrantExpiresAtMs: decision.timedGrantExpiresAtMs }
      : {}),
  });
  if (!payload) return;
  // Router-aware delivery (Pillar 1): when the socket server has registered a
  // responder for this request, hand it the exact signed object and skip the
  // file write. With no responder registered the behaviour is byte-identical to
  // the pre-router filesystem path. The fail-closed early return above (no
  // signing key) happens BEFORE the responder is taken, mirroring the
  // user_question/memory writers — so a no-key call leaves the responder
  // registered to time out (and the socket dispatcher's fail-closed guard
  // settles it at the transport layer).
  const responder = takeIpcResponder(
    sourceAgentFolder,
    `permission-${decision.requestId}`,
  );
  if (responder) {
    responder(payload);
    return;
  }
  writePrivateFileSync(tmpPath, JSON.stringify(payload, null, 2));
  if (fs.existsSync(responsePath)) {
    fs.rmSync(tmpPath, { force: true });
    return;
  }
  fs.renameSync(tmpPath, responsePath);
  protectTerminalResponseFile(responsePath);
}

export function writeUserQuestionIpcResponse(
  ipcBaseDir: string,
  sourceAgentFolder: string,
  response: UserQuestionResponse,
  privateKeyPem?: string,
): void {
  const responseDir = path.join(ipcBaseDir, sourceAgentFolder, 'user-answers');
  ensurePrivateDirSync(responseDir);
  const responsePath = path.join(responseDir, `${response.requestId}.json`);
  if (fs.existsSync(responsePath)) return;
  const tmpPath = `${responsePath}.tmp`;
  const safeAnswers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(response.answers || {})) {
    const safeKey = toTrimmedString(key, { maxLen: 500 });
    if (!safeKey) continue;
    if (typeof value === 'string') {
      safeAnswers[safeKey] = value.slice(0, 500);
      continue;
    }
    if (Array.isArray(value)) {
      const filtered = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.slice(0, 200))
        .slice(0, 20);
      safeAnswers[safeKey] = filtered;
    }
  }
  const payload = withSignature(privateKeyPem, {
    requestId: response.requestId,
    answers: safeAnswers,
    ...(response.answeredBy ? { answeredBy: response.answeredBy } : {}),
  });
  if (!payload) return;
  // Router-aware delivery (Pillar 1): when the socket server has registered a
  // responder for this request, hand it the exact signed object and skip the
  // file write. With no responder registered the behaviour is byte-identical to
  // the pre-router filesystem path. The fail-closed early return above (no
  // signing key) happens BEFORE the responder is taken, mirroring the memory
  // writer — so a no-key call leaves the responder registered to time out.
  const responder = takeIpcResponder(
    sourceAgentFolder,
    `userq-${response.requestId}`,
  );
  if (responder) {
    responder(payload);
    return;
  }
  writePrivateFileSync(tmpPath, JSON.stringify(payload, null, 2));
  if (fs.existsSync(responsePath)) {
    fs.rmSync(tmpPath, { force: true });
    return;
  }
  fs.renameSync(tmpPath, responsePath);
  protectTerminalResponseFile(responsePath);
}
