import type {
  PermissionApprovalRequest,
  PermissionCallbackClaim,
  PermissionCallbackClaimReference,
  PermissionCallbackScope,
} from '../../domain/types.js';

const RESERVED_PERMISSION_DECIDERS = new Set([
  'runtime',
  'system',
  'auto_classifier',
]);

export function sourceAgentFolderFromPermissionPayload(
  payload: Record<string, unknown> | undefined,
): string | null {
  if (typeof payload?.sourceAgentFolder === 'string') {
    return payload.sourceAgentFolder;
  }
  const request = payload?.request;
  return request && typeof request === 'object' && !Array.isArray(request)
    ? ((request as PermissionApprovalRequest).sourceAgentFolder ?? null)
    : null;
}

export function permissionCallbackClaimFromPayload(
  payload: Record<string, unknown>,
): PermissionCallbackClaim | null {
  return permissionCallbackClaimFromValue(payload.permissionCallbackClaim);
}

export function permissionCallbackClaimFromValue(
  value: unknown,
): PermissionCallbackClaim | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const claim = value as Partial<PermissionCallbackClaim>;
  const scope = claim.scope as Partial<PermissionCallbackScope> | undefined;
  const intent = claim.intent as Partial<PermissionCallbackClaim['intent']>;
  const match = claim.match as Partial<PermissionCallbackClaim['match']>;
  if (
    typeof claim.id !== 'string' ||
    typeof scope?.appId !== 'string' ||
    typeof scope.sourceAgentFolder !== 'string' ||
    typeof scope.interactionId !== 'string' ||
    !['allow_once', 'allow_persistent_rule', 'cancel'].includes(
      String(intent?.mode),
    ) ||
    typeof intent?.approverRef !== 'string' ||
    typeof intent.decidedAt !== 'string' ||
    (match?.kind !== 'individual' && match?.kind !== 'batch') ||
    typeof match.canonicalId !== 'string' ||
    !Array.isArray(match.providerAliases) ||
    !match.providerAliases.every((alias) => typeof alias === 'string')
  ) {
    return null;
  }
  return claim as PermissionCallbackClaim;
}

export function samePermissionCallbackClaim(
  left: PermissionCallbackClaim,
  right: PermissionCallbackClaim,
): boolean {
  return (
    left.id === right.id &&
    left.scope.appId === right.scope.appId &&
    left.scope.sourceAgentFolder === right.scope.sourceAgentFolder &&
    left.scope.interactionId === right.scope.interactionId &&
    left.intent.mode === right.intent.mode &&
    left.intent.approverRef === right.intent.approverRef &&
    left.intent.decidedAt === right.intent.decidedAt &&
    left.match.kind === right.match.kind &&
    left.match.canonicalId === right.match.canonicalId
  );
}

export function samePermissionCallbackLocator(
  left: {
    providerAlias: string;
    matchKind: PermissionCallbackClaim['match']['kind'];
    scope: PermissionCallbackScope;
  },
  right: {
    providerAlias: string;
    matchKind: PermissionCallbackClaim['match']['kind'];
    scope: PermissionCallbackScope;
  },
): boolean {
  return (
    left.providerAlias === right.providerAlias &&
    left.matchKind === right.matchKind &&
    left.scope.appId === right.scope.appId &&
    left.scope.sourceAgentFolder === right.scope.sourceAgentFolder &&
    left.scope.interactionId === right.scope.interactionId
  );
}

export function permissionClaimReference(
  claim: PermissionCallbackClaim,
): PermissionCallbackClaimReference {
  return { id: claim.id, scope: claim.scope };
}

export function samePermissionClaim(
  claim: PermissionCallbackClaim,
  reference: PermissionCallbackClaimReference,
): boolean {
  return (
    claim.id === reference.id &&
    claim.scope.appId === reference.scope.appId &&
    claim.scope.sourceAgentFolder === reference.scope.sourceAgentFolder &&
    claim.scope.interactionId === reference.scope.interactionId
  );
}

export function isAllowedPermissionApproverIdentity(
  mode: PermissionCallbackClaim['intent']['mode'],
  approverRef: string,
): boolean {
  const normalized = approverRef.trim().toLowerCase();
  return Boolean(
    normalized &&
    (mode === 'cancel' || !RESERVED_PERMISSION_DECIDERS.has(normalized)),
  );
}
