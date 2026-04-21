import { sql } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const storageMetaSqlite = sqliteTable('storage_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const chatsSqlite = sqliteTable('chats', {
  jid: text('jid').primaryKey(),
  name: text('name'),
  lastMessageTime: text('last_message_time'),
  channel: text('channel'),
  isGroup: integer('is_group').notNull().default(0),
});

export const messagesSqlite = sqliteTable(
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
    pk: uniqueIndex('messages_pk').on(table.id, table.chatJid),
  }),
);
