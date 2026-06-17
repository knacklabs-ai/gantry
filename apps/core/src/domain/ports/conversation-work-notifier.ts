import type { AppId } from '../app/app.js';

export interface ConversationWorkNotificationInput {
  appId: AppId;
  conversationId: string;
  threadId?: string | null;
  messageId: string;
  ownerInstanceId?: string | null;
  leaseVersion?: number | null;
  leaseExpiresAt?: string | null;
}

export type ConversationWorkNotificationPublisher = (
  input: ConversationWorkNotificationInput,
) => Promise<void>;
