import { createHash } from 'node:crypto';

import type { PatternEvidenceRef } from '@gantry/contracts';

import {
  PATTERN_DETECTION_MIN_OCCURRENCES,
  PATTERN_MAX_CANDIDATES_PER_RUN,
} from './pattern-candidate-policy.js';

/**
 * Pure detection heuristic — the Phase 0 gate. No DB, no clock, no LLM. The
 * dreaming job maps conversation turns to {@link PatternTranscriptTurn}s, then
 * calls {@link detectPatternCandidates}.
 *
 * v1 is deliberately simple (frequency over normalized n-grams + repeated
 * intents), not ML clustering. Build clustering only if this provably
 * under-detects on real data.
 */

/** One recurring natural-language task intent extracted from a transcript. */
export interface PatternTranscriptTurn {
  intent: string;
  /** Message/transcript id, used as an evidence ref. */
  messageId: string;
}

export interface PatternCandidateDraft {
  signature: string;
  outcomeLabel: string;
  shortAsk: string;
  occurrences: number;
  evidenceRefs: PatternEvidenceRef[];
}

const MAX_EVIDENCE_PER_CANDIDATE = 25;

interface Accumulator {
  signature: string;
  occurrences: number;
  evidenceKind: PatternEvidenceRef['kind'];
  evidenceIds: Set<string>;
  outcomeLabel: string;
  shortAsk: string;
}

function normalizeIntent(intent: string): string {
  return intent.trim().toLowerCase().replace(/\s+/g, ' ');
}

function signatureFor(kind: 'intent', key: string): string {
  return createHash('sha256')
    .update(`${kind}:${key}`)
    .digest('hex')
    .slice(0, 32);
}

function ensureEntry(
  acc: Map<string, Accumulator>,
  seed: Omit<Accumulator, 'occurrences' | 'evidenceIds'>,
): Accumulator {
  const existing = acc.get(seed.signature);
  if (existing) return existing;
  const created: Accumulator = {
    ...seed,
    occurrences: 0,
    evidenceIds: new Set<string>(),
  };
  acc.set(seed.signature, created);
  return created;
}

export function detectPatternCandidates(input: {
  transcriptTurns: PatternTranscriptTurn[];
}): PatternCandidateDraft[] {
  const acc = new Map<string, Accumulator>();

  // Repeated natural-language intents.
  for (const turn of input.transcriptTurns) {
    const normalized = normalizeIntent(turn.intent);
    if (!normalized) continue;
    const label = turn.intent.trim();
    const entry = ensureEntry(acc, {
      signature: signatureFor('intent', normalized),
      evidenceKind: 'transcript',
      outcomeLabel: label,
      shortAsk: label,
    });
    entry.occurrences += 1;
    entry.evidenceIds.add(turn.messageId);
  }

  return [...acc.values()]
    .filter((entry) => entry.occurrences >= PATTERN_DETECTION_MIN_OCCURRENCES)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, PATTERN_MAX_CANDIDATES_PER_RUN)
    .map((entry) => ({
      signature: entry.signature,
      outcomeLabel: entry.outcomeLabel,
      shortAsk: entry.shortAsk,
      occurrences: entry.occurrences,
      evidenceRefs: [...entry.evidenceIds]
        .slice(0, MAX_EVIDENCE_PER_CANDIDATE)
        .map((id) => ({ kind: entry.evidenceKind, id })),
    }));
}
