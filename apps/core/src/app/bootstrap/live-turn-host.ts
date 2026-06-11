import type { RuntimeLease } from '../../domain/ports/runtime-lease.js';
import type { LiveTurnScope } from '../../domain/ports/live-turns.js';
import type { ExecutionProviderId } from '../../domain/sessions/sessions.js';
import type { NewMessage } from '../../domain/types.js';
import { resolveRuntimeExecutionProviderId } from '../../runtime/execution-provider-id.js';
import { parseThreadQueueKey } from '../../shared/thread-queue-key.js';
import { buildLiveTurnContinuation } from './live-turn-continuation.js';

export const LIVE_TURN_HOST_LEASE_KEY = 'runtime:live-turn-host:default';

export interface LiveTurnHostLeasePort {
  tryAcquire: (key: string) => Promise<RuntimeLease | undefined>;
}

interface LiveTurnRuntimeSettings {
  runtime: {
    liveTurns: {
      enabled: boolean;
    };
  };
}

export async function acquireLiveTurnHostLease(input: {
  runtimeSettings: LiveTurnRuntimeSettings;
  leases: LiveTurnHostLeasePort;
}): Promise<RuntimeLease | undefined> {
  if (!input.runtimeSettings.runtime.liveTurns.enabled) return undefined;
  const lease = await input.leases.tryAcquire(LIVE_TURN_HOST_LEASE_KEY);
  if (!lease) {
    throw new Error(
      'Another Gantry runtime already owns live turns. Set runtime.live_turns.enabled: false on scheduler-only workers.',
    );
  }
  return lease;
}

export interface LiveTurnScopeRepository {
  getAgentTurnContext?: (input: {
    agentFolder: string;
    executionProviderId: ExecutionProviderId;
    conversationJid: string;
    threadId: string | null;
    conversationKind?: 'channel' | 'dm';
    hydrateMemory: boolean;
  }) => Promise<
    | {
        appId: string;
        agentSessionId: string;
      }
    | undefined
  >;
}

interface LiveTurnScopeApp {
  getConversationRoutes(): Record<
    string,
    { folder: string; conversationKind?: 'channel' | 'dm' }
  >;
}

export async function liveTurnScopeForQueue(input: {
  app: LiveTurnScopeApp;
  opsRepository: LiveTurnScopeRepository;
  executionAdapter: { id: ExecutionProviderId };
  queueJid: string;
}): Promise<LiveTurnScope | null> {
  const { app, opsRepository, executionAdapter, queueJid } = input;
  const { chatJid, threadId } = parseThreadQueueKey(queueJid);
  const route = app.getConversationRoutes()[chatJid];
  if (!route) return null;
  const executionProviderId =
    resolveRuntimeExecutionProviderId(executionAdapter);
  const turnContext = await opsRepository.getAgentTurnContext?.({
    agentFolder: route.folder,
    executionProviderId,
    conversationJid: chatJid,
    threadId: threadId ?? null,
    conversationKind: route.conversationKind,
    hydrateMemory: false,
  });
  if (!turnContext?.agentSessionId) return null;
  return {
    appId: turnContext.appId,
    agentSessionId: turnContext.agentSessionId,
    conversationId: chatJid,
    threadId: threadId ?? null,
  };
}

export async function routeScopeActiveLiveTurnAdmission(input: {
  scope: LiveTurnScope;
  queueJid: string;
  liveRunId: string;
  continuation?: {
    text: string;
    senderUserIds: readonly string[];
    idempotencyKey: string;
    cursorAfter?: string | null;
    onRouted: () => Promise<void> | void;
  } | null;
  routeMessage?: (input: {
    scope: LiveTurnScope;
    queueJid: string;
    text: string;
    senderUserIds?: readonly string[] | null;
    idempotencyKey: string;
    cursorAfter?: string | null;
  }) => Promise<'queued_to_owner' | 'no_active_turn' | 'sender_not_allowed'>;
  completeSessionAgentRun?: (input: {
    runId: string;
    status: 'canceled' | 'failed';
    errorSummary: string;
  }) => Promise<unknown>;
}): Promise<boolean> {
  const routed =
    input.continuation && input.routeMessage
      ? await input.routeMessage({
          scope: input.scope,
          queueJid: input.queueJid,
          text: input.continuation.text,
          senderUserIds: input.continuation.senderUserIds,
          idempotencyKey: input.continuation.idempotencyKey,
          cursorAfter: input.continuation.cursorAfter,
        })
      : 'no_active_turn';
  if (routed === 'queued_to_owner') {
    await input.continuation?.onRouted();
  }
  await input.completeSessionAgentRun?.({
    runId: input.liveRunId,
    status: routed === 'queued_to_owner' ? 'canceled' : 'failed',
    errorSummary:
      routed === 'queued_to_owner'
        ? 'Live-turn admission routed the message to the active owner.'
        : `Live-turn admission could not route to active owner: ${routed}`,
  });
  return routed === 'queued_to_owner';
}

export async function routeScopeActiveLiveTurnAdmissionFromCursor(input: {
  scope: LiveTurnScope;
  queueJid: string;
  liveRunId: string;
  chatJid: string;
  threadId: string | null;
  replayCursor: string;
  maxMessagesPerPrompt: number;
  timezone: string;
  getMessagesSince?: (
    conversationJid: string,
    sinceCursor: string,
    limit?: number,
    options?: { threadId?: string | null },
  ) => Promise<NewMessage[]>;
  setAgentCursor: (queueJid: string, cursor: string) => void;
  saveState: () => Promise<void> | void;
  routeMessage: NonNullable<
    Parameters<typeof routeScopeActiveLiveTurnAdmission>[0]['routeMessage']
  >;
  completeSessionAgentRun?: Parameters<
    typeof routeScopeActiveLiveTurnAdmission
  >[0]['completeSessionAgentRun'];
}): Promise<boolean> {
  const messages = await input.getMessagesSince?.(
    input.chatJid,
    input.replayCursor,
    input.maxMessagesPerPrompt,
    { threadId: input.threadId },
  );
  return routeScopeActiveLiveTurnAdmission({
    scope: input.scope,
    queueJid: input.queueJid,
    liveRunId: input.liveRunId,
    continuation: buildLiveTurnContinuation({
      queueJid: input.queueJid,
      messages,
      timezone: input.timezone,
      setAgentCursor: input.setAgentCursor,
      saveState: input.saveState,
    }),
    routeMessage: input.routeMessage,
    completeSessionAgentRun: input.completeSessionAgentRun,
  });
}
