import type { NewMessage } from '../domain/types.js';
import { logger } from '../infrastructure/logging/logger.js';
import type {
  ConversationContextHydrationRequest,
  ConversationContextHydrationResult,
} from './channel-provider.js';
import { nowIso } from '../shared/time/datetime.js';
import {
  teamsConversationIdFromJid,
  type TeamsContextMessage,
  type TeamsSdkClient,
} from './teams-types.js';

export async function hydrateTeamsConversationContext(
  request: ConversationContextHydrationRequest,
  sdkClient: TeamsSdkClient,
  botUserId: string | null,
): Promise<ConversationContextHydrationResult> {
  const conversationId = teamsConversationIdFromJid(request.conversationJid);
  if (!conversationId) {
    return {
      providerId: 'teams',
      attempted: false,
      skipped: true,
      reason: 'invalid_conversation',
    };
  }
  const limit = request.threadId
    ? request.limits.threadMessages
    : request.limits.channelMessages;
  if (limit <= 0) {
    return {
      providerId: 'teams',
      attempted: false,
      skipped: true,
      reason: 'limit_exhausted',
      messages: [],
    };
  }

  if (
    (request.threadId && !sdkClient.listChannelMessageReplies) ||
    (!request.threadId && !sdkClient.listChannelMessages)
  ) {
    return skippedTeamsHydration(request);
  }

  try {
    const rawMessages = request.threadId
      ? await sdkClient.listChannelMessageReplies!({
          conversationId,
          messageId: request.threadId,
          beforeMessageId: request.latestMessage.external_message_id,
          limit,
        })
      : await sdkClient.listChannelMessages!({
          conversationId,
          beforeMessageId: request.latestMessage.external_message_id,
          limit,
        });
    const messages = normalizeTeamsContextMessages(
      request.conversationJid,
      request.threadId || undefined,
      rawMessages,
      limit,
      botUserId,
    );
    logger.debug(
      {
        providerId: 'teams',
        conversationJid: request.conversationJid,
        threadId: request.threadId,
        attempted: true,
        hydratedMessages: messages.length,
      },
      'Teams context hydration completed',
    );
    return { providerId: 'teams', attempted: true, messages };
  } catch (err) {
    logger.debug(
      {
        providerId: 'teams',
        conversationJid: request.conversationJid,
        threadId: request.threadId,
        errorName: err instanceof Error ? err.name : typeof err,
      },
      'Teams context hydration failed',
    );
    return {
      providerId: 'teams',
      attempted: true,
      failed: true,
      reason: 'provider_error',
      messages: [],
    };
  }
}

function skippedTeamsHydration(
  request: ConversationContextHydrationRequest,
): ConversationContextHydrationResult {
  logger.debug(
    {
      providerId: 'teams',
      conversationJid: request.conversationJid,
      threadId: request.threadId,
      attempted: false,
      skipped: true,
      reason: 'unsupported_sdk',
    },
    'Teams context hydration skipped',
  );
  return {
    providerId: 'teams',
    attempted: false,
    skipped: true,
    reason: 'unsupported_sdk',
    messages: [],
  };
}

function normalizeTeamsContextMessages(
  jid: string,
  requestedThreadId: string | undefined,
  rawMessages: TeamsContextMessage[],
  limit: number,
  botUserId: string | null,
): NewMessage[] {
  const byExternalId = new Map<string, NewMessage>();
  for (const message of rawMessages) {
    if (byExternalId.size >= limit) break;
    if (!message.id) continue;
    const content = message.text?.trim() || '';
    const attachments = teamsMessageAttachments(message);
    if (!content && attachments.length === 0) continue;
    const sender = message.senderId || message.from?.id || 'unknown';
    const isSelfMessage = isTeamsSelfMessage(sender, botUserId);
    const threadId = message.threadId || requestedThreadId;
    byExternalId.set(message.id, {
      id: message.id,
      chat_jid: jid,
      provider: 'teams',
      sender,
      sender_name: message.senderName || message.from?.name || sender,
      content,
      timestamp: message.timestamp || nowIso(),
      is_from_me: isSelfMessage,
      is_bot_message: isSelfMessage,
      ...(isSelfMessage ? { delivery_status: 'sent' } : {}),
      thread_id: threadId,
      reply_to_message_id:
        message.replyToId ||
        (threadId && threadId !== message.id ? threadId : undefined),
      external_message_id: message.id,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }
  return Array.from(byExternalId.values()).sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
}

function isTeamsSelfMessage(sender: string, botUserId: string | null): boolean {
  const normalizedBotUserId = botUserId?.trim().toLowerCase();
  if (!normalizedBotUserId) return false;
  const normalizedSender = sender.trim().toLowerCase();
  return (
    normalizedSender === normalizedBotUserId ||
    normalizedSender === `28:${normalizedBotUserId}`
  );
}

export function teamsMessageAttachments(
  message: TeamsContextMessage,
): NonNullable<NewMessage['attachments']> {
  return (message.attachments || []).map((attachment) => ({
    id: attachment.id ? `teams-attachment:${attachment.id}` : undefined,
    kind: attachment.contentType?.startsWith('image/') ? 'image' : 'file',
    contentType: attachment.contentType,
    sizeBytes:
      typeof attachment.sizeBytes === 'number' &&
      Number.isFinite(attachment.sizeBytes)
        ? attachment.sizeBytes
        : undefined,
    externalId: attachment.id,
  }));
}
