import type { Pool, PoolClient } from 'pg';

import type {
  ConversationWorkNotificationInput,
  ConversationWorkNotificationPublisher,
} from '../../../domain/ports/conversation-work-notifier.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export const CONVERSATION_WORK_CHANNEL = 'gantry_conversation_work';
const LISTEN_RECONNECT_DELAY_MS = 1_000;

interface ConversationWorkPgNotifyPayload {
  app_id: string;
  conversation_id: string;
  thread_id: string | null;
  message_id: string;
  owner_instance_id?: string | null;
  lease_version?: number | null;
  lease_expires_at?: string | null;
}

export interface ConversationWorkNotification {
  appId: string;
  conversationId: string;
  threadId: string | null;
  messageId: string;
  ownerInstanceId?: string | null;
  leaseVersion?: number | null;
  leaseExpiresAt?: string | null;
}

function payloadFromInput(
  input: ConversationWorkNotificationInput,
): ConversationWorkPgNotifyPayload {
  return {
    app_id: input.appId,
    conversation_id: input.conversationId,
    thread_id: input.threadId ?? null,
    message_id: input.messageId,
    ...(input.ownerInstanceId !== undefined
      ? { owner_instance_id: input.ownerInstanceId }
      : {}),
    ...(input.leaseVersion !== undefined
      ? { lease_version: input.leaseVersion }
      : {}),
    ...(input.leaseExpiresAt !== undefined
      ? { lease_expires_at: input.leaseExpiresAt }
      : {}),
  };
}

function readOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseConversationWorkNotification(
  payload: string | undefined,
): ConversationWorkNotification | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(
      payload,
    ) as Partial<ConversationWorkPgNotifyPayload>;
    if (
      typeof parsed.app_id !== 'string' ||
      typeof parsed.conversation_id !== 'string' ||
      typeof parsed.message_id !== 'string'
    ) {
      return null;
    }
    const threadId = readOptionalString(parsed.thread_id);
    if (threadId === undefined && parsed.thread_id !== undefined) return null;
    const ownerInstanceId = readOptionalString(parsed.owner_instance_id);
    if (
      ownerInstanceId === undefined &&
      parsed.owner_instance_id !== undefined
    ) {
      return null;
    }
    const leaseVersion = readOptionalNumber(parsed.lease_version);
    if (leaseVersion === undefined && parsed.lease_version !== undefined) {
      return null;
    }
    const leaseExpiresAt = readOptionalString(parsed.lease_expires_at);
    if (leaseExpiresAt === undefined && parsed.lease_expires_at !== undefined) {
      return null;
    }
    return {
      appId: parsed.app_id,
      conversationId: parsed.conversation_id,
      threadId: threadId ?? null,
      messageId: parsed.message_id,
      ...(ownerInstanceId !== undefined ? { ownerInstanceId } : {}),
      ...(leaseVersion !== undefined ? { leaseVersion } : {}),
      ...(leaseExpiresAt !== undefined ? { leaseExpiresAt } : {}),
    };
  } catch {
    return null;
  }
}

export class PostgresConversationWorkNotifier {
  private readonly listeners = new Set<
    (notification: ConversationWorkNotification) => void
  >();
  private clientPromise: Promise<PoolClient> | null = null;
  private client: PoolClient | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly pool: Pool) {}

  async notify(input: ConversationWorkNotificationInput): Promise<void> {
    const payload = JSON.stringify(payloadFromInput(input));
    try {
      await this.pool.query('SELECT pg_notify($1, $2)', [
        CONVERSATION_WORK_CHANNEL,
        payload,
      ]);
    } catch (err) {
      logger.warn(
        {
          err,
          appId: input.appId,
          conversationId: input.conversationId,
          threadId: input.threadId,
          messageId: input.messageId,
        },
        'Failed to publish conversation work notification; subscribers recover by reconciler',
      );
    }
  }

  publisher(): ConversationWorkNotificationPublisher {
    return (input) => this.notify(input);
  }

  subscribe(
    listener: (notification: ConversationWorkNotification) => void,
  ): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    void this.ensureListening();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client ?? (await this.clientPromise?.catch(() => null));
    if (!client) return;
    try {
      await client.query(`UNLISTEN ${CONVERSATION_WORK_CHANNEL}`);
    } finally {
      client.removeAllListeners('notification');
      client.removeAllListeners('error');
      client.release();
      this.client = null;
      this.clientPromise = null;
    }
  }

  private async ensureListening(): Promise<void> {
    if (
      this.client ||
      this.clientPromise ||
      this.closed ||
      this.listeners.size === 0
    ) {
      return;
    }
    this.clientPromise = this.pool.connect();
    let client: PoolClient | null = null;
    try {
      client = await this.clientPromise;
      if (this.closed || this.listeners.size === 0) {
        client.release();
        return;
      }
      this.client = client;
      client.on('notification', (message) => {
        if (message.channel !== CONVERSATION_WORK_CHANNEL) return;
        const notification = parseConversationWorkNotification(message.payload);
        if (!notification) return;
        for (const listener of [...this.listeners]) {
          listener(notification);
        }
      });
      client.on('error', (err) => {
        logger.warn({ err }, 'Conversation work LISTEN client failed');
        this.handleClientFailure(client!, err);
      });
      await client.query(`LISTEN ${CONVERSATION_WORK_CHANNEL}`);
    } catch (err) {
      logger.warn({ err }, 'Failed to start conversation work LISTEN client');
      if (client) this.releaseClient(client, err);
      this.client = null;
      this.clientPromise = null;
      this.scheduleReconnect();
    } finally {
      if (!this.client) {
        this.clientPromise = null;
      }
    }
  }

  private handleClientFailure(client: PoolClient, err: Error): void {
    if (this.client !== client) return;
    this.releaseClient(client, err);
    this.client = null;
    this.clientPromise = null;
    this.scheduleReconnect();
  }

  private releaseClient(client: PoolClient, err?: unknown): void {
    try {
      client.removeAllListeners('notification');
      client.removeAllListeners('error');
      client.release(err instanceof Error ? err : undefined);
    } catch {
      // Best effort release during connection failure handling.
    }
  }

  private scheduleReconnect(): void {
    if (
      this.closed ||
      this.listeners.size === 0 ||
      this.client ||
      this.clientPromise ||
      this.reconnectTimer
    ) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureListening();
    }, LISTEN_RECONNECT_DELAY_MS);
    this.reconnectTimer.unref?.();
  }
}
