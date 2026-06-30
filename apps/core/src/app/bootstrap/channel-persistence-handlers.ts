import type { ConversationRoute, NewMessage } from '../../domain/types.js';
import { agentIdForFolder } from '../../domain/agent/agent-folder-id.js';
import type {
  RuntimeChatMetadataRepository,
  RuntimeMessageRepository,
} from '../../domain/repositories/ops-repo.js';
import {
  findConversationRoutesForChat,
  parseAgentThreadQueueKey,
} from '../../shared/thread-queue-key.js';
import type { RuntimeApp } from './runtime-app.js';
import type { AsyncTaskQueue } from './async-task-queue.js';
import type { ChannelWiringDeps } from './channel-wiring-types.js';

type ChannelPersistenceRepository = RuntimeChatMetadataRepository &
  RuntimeMessageRepository;

interface ChannelPersistenceHandlerDeps {
  app: RuntimeApp;
  resolved: ChannelWiringDeps;
  ops: () => ChannelPersistenceRepository;
  persistenceQueue: AsyncTaskQueue;
}

async function enqueueAndWait(
  queue: AsyncTaskQueue,
  task: () => Promise<void>,
  onFull: () => void,
): Promise<void> {
  let resolveCompletion!: () => void;
  let rejectCompletion!: (err: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const wrapped = async () => {
    try {
      await task();
      resolveCompletion();
    } catch (err) {
      rejectCompletion(err);
    }
  };
  const admitted = queue.enqueue(wrapped);
  if (!admitted) {
    onFull();
    await queue.enqueueWhenAvailable(wrapped);
  }
  await completion;
}

export function createChannelPersistenceHandlers({
  app,
  resolved,
  ops,
  persistenceQueue,
}: ChannelPersistenceHandlerDeps) {
  const chatIsGroup = new Map<string, boolean>();

  const routesForChat = (chatJid: string, threadId?: string | null) => {
    const byAgent = new Map<string, ConversationRoute>();
    for (const [key, route] of findConversationRoutesForChat(
      app.getConversationRoutes(),
      chatJid,
      threadId,
    )) {
      const parsed = parseAgentThreadQueueKey(key);
      const agentId = agentIdForFolder(route.folder);
      if (!byAgent.has(agentId) || parsed.agentId) byAgent.set(agentId, route);
    }
    return [...byAgent.values()];
  };

  const ensureConfiguredConversationRoute = async (
    chatJid: string,
    msg: NewMessage,
  ): Promise<boolean> => {
    const existingGroup = routesForChat(chatJid, msg.thread_id)[0];
    const isKnownDirect =
      chatIsGroup.get(chatJid) === false ||
      existingGroup?.conversationKind === 'dm';
    if (!isKnownDirect) return Boolean(existingGroup);
    if (!existingGroup && !msg.is_from_me && !msg.is_bot_message) {
      resolved.logger.warn(
        { chatJid, sender: msg.sender },
        'Dropping direct message without configured conversation binding',
      );
    }
    return Boolean(existingGroup);
  };

  return {
    ensureMessageRoute: ensureConfiguredConversationRoute,
    onMessage: async (chatJid: string, msg: NewMessage) => {
      const canRoute = await ensureConfiguredConversationRoute(chatJid, msg);
      if (!canRoute) return;
      let routes = routesForChat(chatJid, msg.thread_id);
      if (!msg.is_from_me && !msg.is_bot_message && routes.length > 0) {
        const cfg = resolved.loadSenderAllowlist();
        routes = routes.filter((route) => {
          if (
            !resolved.shouldDropMessage(chatJid, cfg, route.folder) ||
            resolved.isSenderAllowed(chatJid, msg.sender, cfg, route.folder)
          ) {
            return true;
          }
          if (resolved.shouldLogDenied(chatJid, cfg)) {
            resolved.logger.debug(
              { chatJid, sender: msg.sender, agentFolder: route.folder },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return false;
        });
        if (routes.length === 0) {
          return;
        }
      }

      const persistMessage = async () => {
        try {
          const repository = ops();
          const shouldEnqueueLiveAdmission =
            routes.length > 0 && !msg.is_from_me && !msg.is_bot_message;
          if (
            shouldEnqueueLiveAdmission &&
            repository.storeMessageWithLiveAdmission
          ) {
            for (const route of routes) {
              await repository.storeMessageWithLiveAdmission(msg, {
                appId: resolved.appId,
                agentId: agentIdForFolder(route.folder),
                triggerDecision: {
                  source: 'channel_persistence',
                  requiresTrigger: route.requiresTrigger !== false,
                  conversationKind: route.conversationKind ?? null,
                },
              });
            }
            return;
          }
          await repository.storeMessage(msg);
        } catch (err) {
          resolved.logger.error({ err, chatJid }, 'Failed to store message');
          throw err;
        }
      };
      await enqueueAndWait(persistenceQueue, persistMessage, () =>
        resolved.logger.warn(
          { chatJid, queueSize: persistenceQueue.size() },
          'Persistence queue full; waiting to enqueue message persistence',
        ),
      );
    },
    onChatMetadata: async (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => {
      if (isGroup !== undefined) chatIsGroup.set(chatJid, Boolean(isGroup));
      const persistMetadata = async () => {
        try {
          await ops().storeChatMetadata(
            chatJid,
            timestamp,
            name,
            channel,
            isGroup,
          );
        } catch (err) {
          resolved.logger.error(
            { err, chatJid },
            'Failed to store chat metadata',
          );
          throw err;
        }
      };
      await enqueueAndWait(persistenceQueue, persistMetadata, () =>
        resolved.logger.warn(
          { chatJid, queueSize: persistenceQueue.size() },
          'Persistence queue full; waiting to enqueue chat metadata persistence',
        ),
      );
    },
  };
}
