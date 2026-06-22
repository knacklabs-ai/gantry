import type { PatternCandidateRepository } from '../domain/ports/pattern-candidates.js';
import { memoryAgentIdForWorkspaceFolder } from '../memory/app-memory-boundaries.js';
import { applyPatternCandidateChoice } from '../memory/pattern-candidate-decision.js';
import { nowIso } from '../shared/time/datetime.js';
import { candidateBelongsToRequest } from './pattern-candidate-ipc-handlers.js';

type ProposalStatus =
  | 'proposal_pending_review'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'proposal_blocked';

export async function claimPatternCandidateForSkillProposal(input: {
  repo: PatternCandidateRepository;
  candidateId: string;
  appId: string;
  sourceAgentFolder: string;
  targetJid: string;
  memoryUserId?: string;
}): Promise<
  | { ok: true; lifecycle: Record<string, () => Promise<void>> }
  | { ok: false; error: string; code: string }
> {
  const candidate = await input.repo.getById(input.candidateId);
  const agentId = memoryAgentIdForWorkspaceFolder(input.sourceAgentFolder);
  if (
    !candidateBelongsToRequest({
      candidate,
      appId: input.appId,
      agentId,
      targetJid: input.targetJid,
      memoryUserId: input.memoryUserId,
    })
  ) {
    return {
      ok: false,
      error: 'Pattern candidate is not valid for this request.',
      code: 'forbidden',
    };
  }
  const transitioned = await applyPatternCandidateChoice({
    repo: input.repo,
    candidateId: input.candidateId,
    choice: 'create_draft',
    nowIso: nowIso(),
  });
  if (!transitioned) {
    return {
      ok: false,
      error: 'Pattern candidate is no longer available for this request.',
      code: 'invalid_state',
    };
  }
  const setStatus = (proposalStatus: ProposalStatus) =>
    input.repo.setProposalStatus({
      id: input.candidateId,
      proposalStatus,
      nowIso: nowIso(),
    });
  return {
    ok: true,
    lifecycle: {
      onReviewStarted: async () =>
        void (await setStatus('proposal_pending_review')),
      onApproved: async () => void (await setStatus('proposal_approved')),
      onRejected: async () => void (await setStatus('proposal_rejected')),
      onBlocked: async () => void (await setStatus('proposal_blocked')),
    },
  };
}
