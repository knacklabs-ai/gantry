import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const manipalPlatformEventsPostgres = pgTable(
  'manipal_platform_events',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    targetJid: text('target_jid'),
    status: text('status').notNull(),
    payloadJson: text('payload_json').notNull(),
    responseJson: text('response_json'),
    error: text('error'),
    receivedAt: timestamp('received_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
  },
  (table) => ({
    statusIdx: index('idx_manipal_platform_events_status').on(
      table.status,
      table.updatedAt,
    ),
    targetIdx: index('idx_manipal_platform_events_target').on(
      table.targetJid,
      table.updatedAt,
    ),
  }),
);
