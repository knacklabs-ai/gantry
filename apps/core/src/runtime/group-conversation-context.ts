import { logger } from '../infrastructure/logging/logger.js';
import { formatConversationContextMessages } from '../messaging/router.js';
import { buildMemoryRecallQueryFromMessages } from '../memory/app-memory-recall-query.js';
import type { NewMessage } from '../domain/types.js';
import {
  isSenderAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from '../platform/sender-allowlist.js';
import type {
  GroupProcessingDeps,
  GroupProcessingRepository,
} from './group-processing-types.js';
import {
  buildConversationContextPacket,
  CONVERSATION_CONTEXT_LIMITS,
} from './conversation-context.js';

export async function buildGroupTurnConversationContext(input: {
  deps: GroupProcessingDeps;
  repository: GroupProcessingRepository;
  agentFolder: string;
  chatJid: string;
  activeThreadId: string | null | undefined;
  latestMessage: NewMessage;
  currentMessages: NewMessage[];
  timezone: string;
}) {
  let conversationContext = await buildConversationContextPacket({
    conversationJid: input.chatJid,
    activeThreadId: input.activeThreadId,
    latestMessage: input.latestMessage,
    currentMessages: input.currentMessages,
    repository: input.repository,
  });
  const hydration = shouldHydrateConversationContext(conversationContext)
    ? await input.deps.channelRuntime
        .hydrateConversationContext?.({
          conversationJid: input.chatJid,
          threadId: input.activeThreadId,
          latestMessage: input.latestMessage,
          limits: CONVERSATION_CONTEXT_LIMITS,
        })
        .catch((err) => {
          logger.warn(
            {
              hydrationError: hydrationErrorDiagnostics(err),
              providerId: input.latestMessage.provider,
              chatJid: input.chatJid,
              threadId: input.activeThreadId,
            },
            'Conversation context hydration failed',
          );
          return undefined;
        })
    : undefined;
  const rawHydratedMessages = hydration?.messages ?? [];
  const hydratedMessages = filterHydratedMessagesBySenderPolicy({
    chatJid: input.chatJid,
    agentFolder: input.agentFolder,
    messages: rawHydratedMessages,
  });
  const droppedHydratedMessages =
    rawHydratedMessages.length - hydratedMessages.length;
  if (droppedHydratedMessages > 0) {
    logger.debug(
      {
        chatJid: input.chatJid,
        providerId: hydration?.providerId,
        messageCount: rawHydratedMessages.length,
        droppedCount: droppedHydratedMessages,
      },
      'Conversation context hydration dropped messages by sender policy',
    );
  }
  let storedHydratedMessageCount = 0;
  let failedHydratedMessageCount = 0;
  for (const message of hydratedMessages) {
    try {
      await input.repository.storeMessage(message);
      storedHydratedMessageCount += 1;
    } catch (err) {
      failedHydratedMessageCount += 1;
      logger.warn(
        {
          storeError: hydrationErrorDiagnostics(err),
          providerId: hydration?.providerId,
          chatJid: input.chatJid,
          threadId: input.activeThreadId,
          messageId: message.id,
          externalMessageId: message.external_message_id,
          messageThreadId: message.thread_id,
          isFromMe: message.is_from_me,
          isBotMessage: message.is_bot_message,
        },
        'Conversation context hydration message persistence failed',
      );
    }
  }
  if (hydratedMessages.length > 0) {
    conversationContext = await buildConversationContextPacket({
      conversationJid: input.chatJid,
      activeThreadId: input.activeThreadId,
      latestMessage: input.latestMessage,
      currentMessages: input.currentMessages,
      repository: input.repository,
    });
  }
  return {
    prompt: formatConversationContextMessages(
      conversationContext,
      input.timezone,
    ),
    recallQuery: buildMemoryRecallQueryFromMessages([
      ...conversationContext.recentChannelContext,
      ...conversationContext.activeThreadContext,
      ...conversationContext.currentMessages,
    ]),
    logContext: {
      context: conversationContext.metadata,
      hydration: hydration
        ? {
            providerId: hydration.providerId,
            attempted: hydration.attempted,
            skipped: hydration.skipped === true,
            failed: hydration.failed === true,
            messageCount: rawHydratedMessages.length,
            storeAttemptedMessageCount: hydratedMessages.length,
            storedMessageCount: storedHydratedMessageCount,
            storeFailedMessageCount: failedHydratedMessageCount,
            droppedMessageCount: droppedHydratedMessages,
          }
        : undefined,
    },
  };
}

function shouldHydrateConversationContext(
  context: Awaited<ReturnType<typeof buildConversationContextPacket>>,
) {
  if (context.metadata.activeThreadId) {
    return (
      !context.metadata.activeThreadWindowComplete ||
      !context.metadata.activeThreadRootPresent
    );
  }
  return !context.metadata.recentChannelWindowComplete;
}

function filterHydratedMessagesBySenderPolicy(input: {
  chatJid: string;
  agentFolder: string;
  messages: NewMessage[];
}): NewMessage[] {
  if (input.messages.length === 0) return input.messages;
  const allowlistCfg = loadSenderAllowlist();
  return input.messages.filter((message) => {
    if (message.is_from_me) return true;
    if (!shouldDropMessage(input.chatJid, allowlistCfg, input.agentFolder)) {
      return true;
    }
    return isSenderAllowed(
      input.chatJid,
      message.sender,
      allowlistCfg,
      input.agentFolder,
    );
  });
}

function hydrationErrorDiagnostics(err: unknown): {
  errorName?: string;
  errorCode?: string;
  errorConstraint?: string;
} {
  if (!err || typeof err !== 'object') return {};
  const record = err as {
    name?: unknown;
    code?: unknown;
    constraint?: unknown;
  };
  return {
    ...(typeof record.name === 'string' ? { errorName: record.name } : {}),
    ...(typeof record.code === 'string' ? { errorCode: record.code } : {}),
    ...(typeof record.constraint === 'string'
      ? { errorConstraint: record.constraint }
      : {}),
  };
}
