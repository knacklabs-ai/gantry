import { createHash } from 'node:crypto';

import type { RuntimeConfiguredConversation } from '../../shared/runtime-settings.js';

export function configuredConversationId(input: {
  providerAccountId: string;
  externalId: string;
  conversations: Record<string, RuntimeConfiguredConversation>;
}): string | undefined {
  return rankedConversationMatches(input)[0];
}

function rankedConversationMatches(input: {
  providerAccountId: string;
  externalId: string;
  conversations: Record<string, RuntimeConfiguredConversation>;
}): string[] {
  return Object.entries(input.conversations)
    .filter(
      ([, conversation]) =>
        conversation.providerAccount === input.providerAccountId &&
        conversation.externalId === input.externalId,
    )
    .sort(([leftId, left], [rightId, right]) => {
      const score =
        conversationSettingsScore(right) - conversationSettingsScore(left);
      return score || leftId.localeCompare(rightId);
    })
    .map(([id]) => id);
}

function conversationSettingsScore(
  conversation: RuntimeConfiguredConversation,
): number {
  return conversation.controlApprovers.length > 0 ? 1 : 0;
}

export function stableSettingsId(
  seed: string,
  existing: Record<string, unknown>,
): string {
  const base =
    seed
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'item';
  if (!Object.hasOwn(existing, base)) return base;
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return `${base}_${hash}`.slice(0, 96);
}
