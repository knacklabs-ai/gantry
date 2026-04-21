import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const storageMetaPostgres = pgTable('storage_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chatsPostgres = pgTable('chats', {
  jid: text('jid').primaryKey(),
  name: text('name'),
  lastMessageTime: text('last_message_time'),
  channel: text('channel'),
  isGroup: boolean('is_group').notNull().default(false),
});

export const messagesPostgres = pgTable(
  'messages',
  {
    id: text('id').notNull(),
    chatJid: text('chat_jid').notNull(),
    sender: text('sender'),
    senderName: text('sender_name'),
    content: text('content'),
    timestamp: text('timestamp'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.chatJid] }),
  }),
);
