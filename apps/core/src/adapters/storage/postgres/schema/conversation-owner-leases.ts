import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { appsPostgres } from './apps.js';
import {
  conversationsPostgres,
  conversationThreadsPostgres,
} from './conversations.js';

export const conversationOwnerLeasesPostgres = pgTable(
  'conversation_owner_leases',
  {
    appId: text('app_id')
      .notNull()
      .references(() => appsPostgres.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversationsPostgres.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(
      () => conversationThreadsPostgres.id,
      {
        onDelete: 'cascade',
      },
    ),
    threadKey: text('thread_key').notNull(),
    ownerInstanceId: text('owner_instance_id').notNull(),
    workerId: text('worker_id'),
    leaseVersion: bigint('lease_version', { mode: 'number' }).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    heartbeatAt: timestamp('heartbeat_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    state: text('state').notNull(),
    lastClaimReason: text('last_claim_reason'),
    lastError: text('last_error'),
    drainingStartedAt: timestamp('draining_started_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    conversationThreadUnique: unique(
      'conversation_owner_leases_app_conversation_thread_key_key',
    ).on(table.appId, table.conversationId, table.threadKey),
    leaseExpiresAtIdx: index('idx_conversation_owner_leases_expires_at').on(
      table.leaseExpiresAt,
    ),
    ownerStateIdx: index('idx_conversation_owner_leases_owner_state').on(
      table.ownerInstanceId,
      table.state,
    ),
  }),
);
