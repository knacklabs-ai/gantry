import { z } from 'zod';

import { IsoDateTimeSchema } from '../contract-primitives.js';

/**
 * Pattern candidates are the "patterns I've noticed" signal: repeated work the
 * daily memory job detected, surfaced to the agent so it can propose a durable
 * skill in conversation. They are deliberately NOT memory items — different
 * lifecycle, different blast radius — and live in their own `pattern_candidate`
 * table. See docs plan: agent personality & the permanent-employee feedback loop.
 */

/** A reference back to the evidence that produced a candidate. Typed, not loose ids. */
export const PatternEvidenceRefSchema = z.object({
  kind: z.enum(['event', 'transcript']),
  id: z.string(),
});
export type PatternEvidenceRef = z.infer<typeof PatternEvidenceRefSchema>;

/**
 * Candidate lifecycle, kept separate from proposal outcome so "accepted" never
 * means both "user clicked Create draft" and "review approved".
 * detected -> suggested -> accepted | snoozed | dismissed.
 */
export const PatternCandidateStatusSchema = z.enum([
  'detected',
  'suggested',
  'accepted',
  'snoozed',
  'dismissed',
]);
export type PatternCandidateStatus = z.infer<
  typeof PatternCandidateStatusSchema
>;

/**
 * Proposal outcome, set only after a candidate is accepted. Tracks what the
 * existing reviewed-proposal surface did with the draft.
 */
export const PatternProposalStatusSchema = z.enum([
  'proposal_requested',
  'proposal_pending_review',
  'proposal_approved',
  'proposal_rejected',
  'proposal_blocked',
]);
export type PatternProposalStatus = z.infer<typeof PatternProposalStatusSchema>;

export const PatternCandidateSchema = z.object({
  id: z.string(),
  appId: z.string(),
  agentId: z.string(),
  folder: z.string(),
  /** Subject scope (user/agent/group/...), same scoping as memory_items. */
  subjectType: z.string(),
  subjectId: z.string(),
  /** Stable hash of the normalized sequence/intent; the dedup key. */
  signature: z.string(),
  /**
   * Human-facing "we have done this" outcome, e.g. "export + summarize
   * feedback".
   */
  outcomeLabel: z.string(),
  /** Human-facing "next time you can just ask for ..." short ask. */
  shortAsk: z.string(),
  occurrences: z.number().int().min(1),
  windowStart: IsoDateTimeSchema,
  windowEnd: IsoDateTimeSchema,
  lastDetectedAt: IsoDateTimeSchema,
  candidateStatus: PatternCandidateStatusSchema,
  proposalStatus: PatternProposalStatusSchema.nullable(),
  snoozedUntil: IsoDateTimeSchema.nullable(),
  evidenceRefs: z.array(PatternEvidenceRefSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PatternCandidate = z.infer<typeof PatternCandidateSchema>;
