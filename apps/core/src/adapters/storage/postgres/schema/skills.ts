import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { agentsPostgres } from './agents.js';
import { appsPostgres } from './apps.js';

export const skillCatalogPostgres = pgTable(
  'skill_catalog',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => appsPostgres.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    source: text('source').notNull().default('bundled'),
    status: text('status').notNull().default('active'),
    version: text('version').notNull(),
    promptRefsJson: text('prompt_refs_json').notNull().default('[]'),
    toolIdsJson: text('tool_ids_json').notNull().default('[]'),
    workflowRefsJson: text('workflow_refs_json').notNull().default('[]'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    appNameVersionUnique: uniqueIndex('idx_skill_catalog_app_name_version').on(
      table.appId,
      table.name,
      table.version,
    ),
  }),
);

export const skillVersionsPostgres = pgTable(
  'skill_versions',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id')
      .notNull()
      .references(() => skillCatalogPostgres.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    entrypoint: text('entrypoint').notNull().default('SKILL.md'),
    manifestJson: text('manifest_json').notNull().default('{}'),
    contentHash: text('content_hash').notNull(),
    approvalStatus: text('approval_status').notNull().default('draft'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    skillVersionUnique: uniqueIndex('idx_skill_versions_skill_version').on(
      table.skillId,
      table.version,
    ),
    skillApprovalIdx: index('idx_skill_versions_approval').on(
      table.skillId,
      table.approvalStatus,
    ),
  }),
);

export const skillAssetsPostgres = pgTable(
  'skill_assets',
  {
    id: text('id').primaryKey(),
    skillVersionId: text('skill_version_id')
      .notNull()
      .references(() => skillVersionsPostgres.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    contentType: text('content_type').notNull(),
    storageType: text('storage_type').notNull(),
    storageRef: text('storage_ref').notNull(),
    contentHash: text('content_hash').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
  },
  (table) => ({
    versionPathUnique: uniqueIndex('idx_skill_assets_version_path').on(
      table.skillVersionId,
      table.path,
    ),
  }),
);

export const agentSkillBindingsPostgres = pgTable(
  'agent_skill_bindings',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => appsPostgres.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentsPostgres.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skillCatalogPostgres.id, { onDelete: 'cascade' }),
    skillVersionId: text('skill_version_id').references(
      () => skillVersionsPostgres.id,
      { onDelete: 'set null' },
    ),
    configVersionId: text('config_version_id'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentSkillUnique: uniqueIndex('idx_agent_skill_bindings_unique').on(
      table.agentId,
      table.skillId,
    ),
  }),
);

export const skillRegistryEventsPostgres = pgTable(
  'skill_registry_events',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => appsPostgres.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    skillId: text('skill_id').references(() => skillCatalogPostgres.id, {
      onDelete: 'set null',
    }),
    skillVersionId: text('skill_version_id').references(
      () => skillVersionsPostgres.id,
      { onDelete: 'set null' },
    ),
    agentId: text('agent_id').references(() => agentsPostgres.id, {
      onDelete: 'set null',
    }),
    actorRef: text('actor_ref'),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    appEventIdx: index('idx_skill_registry_events_app_event').on(
      table.appId,
      table.eventType,
      table.createdAt,
    ),
  }),
);
