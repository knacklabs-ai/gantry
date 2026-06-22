import type { PatternCandidateRepository } from '../domain/ports/pattern-candidates.js';
import { memoryAgentIdForWorkspaceFolder } from '../memory/app-memory-boundaries.js';
import { canonicalConversationIdForMemory } from '../memory/app-memory-subject-resolver.js';
import { applyPatternCandidateChoice } from '../memory/pattern-candidate-decision.js';
import { nowIso } from '../shared/time/datetime.js';
import { createTaskResponder, toTrimmedString } from './ipc-shared.js';
import type { TaskHandler } from './ipc-types.js';

type PatternCandidateRuntimeDeps = {
  getStorage: () => {
    repositories: {
      patternCandidates?: PatternCandidateRepository;
    };
  };
};

let runtimeDeps: PatternCandidateRuntimeDeps | null = null;

export function configurePatternCandidateIpcHandlers(
  deps: PatternCandidateRuntimeDeps,
): void {
  runtimeDeps = deps;
}

function getRuntimeDeps(): PatternCandidateRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error('Pattern candidate IPC handlers are not configured.');
  }
  return runtimeDeps;
}

export function candidateBelongsToRequest(input: {
  candidate: Awaited<ReturnType<PatternCandidateRepository['getById']>>;
  appId: string;
  agentId: string;
  targetJid: string;
  memoryUserId?: string;
}): boolean {
  const candidate = input.candidate;
  if (!candidate) return false;
  if (candidate.appId !== input.appId || candidate.agentId !== input.agentId) {
    return false;
  }
  const channelSubjectId = canonicalConversationIdForMemory(input.targetJid);
  return (
    (candidate.subjectType === 'channel' &&
      candidate.subjectId === channelSubjectId) ||
    (candidate.subjectType === 'user' &&
      (candidate.subjectId === input.memoryUserId ||
        candidate.subjectId === input.targetJid)) ||
    candidate.subjectId === input.targetJid
  );
}

export const patternCandidateDecisionHandler: TaskHandler = async (context) => {
  const { accept, reject } = createTaskResponder(
    context.sourceAgentFolder,
    context.data.taskId,
    context.data.authThreadId,
    context.data.responseKeyId,
  );
  const { data, sourceAgentFolder } = context;
  const payload = data.payload || {};
  if (!data.appId) {
    reject(
      'Pattern candidate decisions require signed app scope.',
      'forbidden',
    );
    return;
  }
  const patternCandidateId = toTrimmedString(payload.patternCandidateId, {
    maxLen: 512,
  });
  const choice = toTrimmedString(payload.choice, { maxLen: 32 });
  if (!patternCandidateId) {
    reject('Missing required field: patternCandidateId.', 'invalid_request');
    return;
  }
  if (choice !== 'not_now' && choice !== 'dismiss') {
    reject('Invalid pattern candidate decision.', 'invalid_request');
    return;
  }
  const targetJid = data.targetJid || data.chatJid || '';
  if (!context.sourceAgentFolderJids.includes(targetJid)) {
    reject(
      'Pattern candidate decision must target a chat bound to the requesting agent.',
      'forbidden',
    );
    return;
  }
  const repo = getRuntimeDeps().getStorage().repositories.patternCandidates;
  if (!repo) {
    reject(
      'Pattern candidate repository is not available.',
      'preflight_failed',
    );
    return;
  }
  const candidate = await repo.getById(patternCandidateId);
  const agentId = memoryAgentIdForWorkspaceFolder(sourceAgentFolder);
  if (
    !candidateBelongsToRequest({
      candidate,
      appId: data.appId,
      agentId,
      targetJid,
      memoryUserId: data.memoryUserId,
    })
  ) {
    reject('Pattern candidate is not valid for this request.', 'forbidden');
    return;
  }
  const transitioned = await applyPatternCandidateChoice({
    repo,
    candidateId: patternCandidateId,
    choice,
    nowIso: nowIso(),
  });
  if (!transitioned) {
    reject(
      'Pattern candidate is no longer available for this request.',
      'invalid_state',
    );
    return;
  }
  accept('Pattern decision recorded.', 'pattern_candidate_decision_recorded');
};
