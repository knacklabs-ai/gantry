import { decisionForMode } from '../domain/permission-decision.js';
import type {
  PermissionApprovalDecision,
  PermissionApprovalRequest,
} from '../domain/types.js';
import {
  evaluatePermissionDeterministicRails,
  type PermissionDeterministicRailDecision,
  type PermissionDeterministicRailsInput,
} from '../domain/permission-deterministic-rails.js';
import type { ToolPolicyDecision } from '../shared/tool-execution-policy-service.js';
import type { PermissionDecisionMemoryRepository } from '../domain/ports/permission-decision-memory.js';

export type DeterministicPermissionRails = (
  input: PermissionDeterministicRailsInput,
) => PermissionDeterministicRailDecision | undefined;

export interface CoordinatePermissionDecisionInput {
  request: PermissionApprovalRequest;
  hardDenyReason?: string;
  accessPreset?: 'full' | 'locked';
  fixedImageRestricted?: boolean;
  reviewedRuleDecision?:
    | ToolPolicyDecision
    | (() => Promise<ToolPolicyDecision | undefined>);
  deterministicRails?: DeterministicPermissionRails;
  deterministicRailsInput?: Omit<PermissionDeterministicRailsInput, 'request'>;
  /** Versioned effect hash (Task B); undefined ⇒ input uncacheable, cache skipped. */
  effectHash?: string;
  /** Classifier-verdict cache (Task C); read only on a rail fall-through. */
  decisionMemory?: PermissionDecisionMemoryRepository;
  tail: () => Promise<PermissionApprovalDecision>;
}

export async function coordinatePermissionDecision(
  input: CoordinatePermissionDecisionInput,
): Promise<PermissionApprovalDecision> {
  if (input.hardDenyReason) {
    return denied(input.request, input.hardDenyReason, 'hard_deny');
  }
  if (input.accessPreset === 'locked') {
    return denied(
      input.request,
      'capability not provisioned: this agent runs with a locked access preset.',
      'locked_preset',
    );
  }
  if (input.fixedImageRestricted) {
    return denied(
      input.request,
      'capability not provisioned: this run uses a fixed authority image.',
      'fixed_image',
    );
  }
  const reviewedRuleDecision =
    typeof input.reviewedRuleDecision === 'function'
      ? await input.reviewedRuleDecision()
      : input.reviewedRuleDecision;
  if (reviewedRuleDecision?.status === 'allow') {
    return {
      ...decisionForMode(input.request, 'allow_once', 'reviewed_rule'),
      reason: reviewedRuleDecision.reason,
    };
  }
  if (reviewedRuleDecision) {
    input.request.decisionReason = reviewedRuleDecision.reason;
    input.request.closestRule = reviewedRuleDecision.closestRule;
  }
  const railDecision = (
    input.deterministicRails ?? evaluatePermissionDeterministicRails
  )({
    request: input.request,
    ...input.deterministicRailsInput,
  });
  // Rails re-run on EVERY call, BEFORE any cache read (re-run-every-hit): a
  // deny/allow floor wins unchanged, and an ask-floor overrides even a cached
  // allow — so the cache is consulted ONLY when rails fall through entirely.
  if (railDecision) {
    if (railDecision.railOutcome === 'ask') {
      input.request.decisionReason = railDecision.reason;
      return input.tail();
    }
    return railDecision;
  }
  // CACHE STAGE (cache-hit-only shortcut). Reachable only past hard-deny/
  // locked/fixed-image (PERM-1 precedence, checked above) and past the rails.
  if (input.effectHash && input.decisionMemory) {
    const cached = await input.decisionMemory.getClassifierVerdict({
      appId: input.request.appId ?? 'default',
      agentFolder: input.request.sourceAgentFolder,
      effectHash: input.effectHash,
    });
    if (cached?.decision === 'allow') {
      return {
        ...decisionForMode(
          input.request,
          'allow_once',
          'cached_classifier_verdict',
        ),
        reason: cached.reason,
      };
    }
  }
  return input.tail();
}

interface PermissionRunRestriction {
  hideAuthorityTools: boolean;
}

const permissionRunRestrictions = new Map<string, PermissionRunRestriction>();

export function registerPermissionRunRestriction(input: {
  sourceAgentFolder: string;
  responseKeyId: string;
  hideAuthorityTools: boolean;
}): void {
  permissionRunRestrictions.set(restrictionKey(input), {
    hideAuthorityTools: input.hideAuthorityTools,
  });
}

export function permissionRunRestriction(input: {
  sourceAgentFolder: string;
  responseKeyId: string;
}): PermissionRunRestriction | undefined {
  return permissionRunRestrictions.get(restrictionKey(input));
}

export function unregisterPermissionRunRestriction(input: {
  sourceAgentFolder: string;
  responseKeyId: string;
}): void {
  permissionRunRestrictions.delete(restrictionKey(input));
}

function restrictionKey(input: {
  sourceAgentFolder: string;
  responseKeyId: string;
}): string {
  return `${input.sourceAgentFolder}\u0000${input.responseKeyId}`;
}

function denied(
  request: PermissionApprovalRequest,
  reason: string,
  decidedBy: string,
): PermissionApprovalDecision {
  return {
    ...decisionForMode(request, 'cancel', decidedBy),
    reason,
  };
}
