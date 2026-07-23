import { z } from 'zod';

import { IsoDateTimeSchema } from '../contract-primitives.js';

export const AgentSetupStageSchema = z.enum([
  'agent',
  'model',
  'connection',
  'conversation',
  'profile',
  'review',
]);
export type AgentSetupStage = z.infer<typeof AgentSetupStageSchema>;

const SetupMetadataSchema = z.record(z.string(), z.unknown());

export const AgentSetupDraftSchema = z
  .object({
    agentId: z.string(),
    appId: z.string(),
    name: z.string().min(1),
    purpose: z.string().nullable(),
    modelAlias: z.string().nullable(),
    connection: SetupMetadataSchema.nullable(),
    conversation: SetupMetadataSchema.nullable(),
    currentStage: AgentSetupStageSchema,
    version: z.number().int().positive(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type AgentSetupDraft = z.infer<typeof AgentSetupDraftSchema>;

export const CreateAgentSetupRequestSchema = z
  .object({
    appId: z.string(),
    name: z.string().trim().min(1).max(160),
    purpose: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type CreateAgentSetupRequest = z.infer<
  typeof CreateAgentSetupRequestSchema
>;

const AgentSetupExpectedVersionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const UpdateAgentSetupRequestSchema = z.discriminatedUnion('step', [
  AgentSetupExpectedVersionSchema.extend({
    step: z.literal('agent'),
    name: z.string().trim().min(1).max(160),
    purpose: z.string().trim().max(2_000).optional(),
  }),
  AgentSetupExpectedVersionSchema.extend({
    step: z.literal('model'),
    modelAlias: z.string().trim().min(1),
  }),
  AgentSetupExpectedVersionSchema.extend({
    step: z.literal('connection'),
    connection: SetupMetadataSchema,
  }),
  AgentSetupExpectedVersionSchema.extend({
    step: z.literal('conversation'),
    conversation: SetupMetadataSchema,
  }),
  AgentSetupExpectedVersionSchema.extend({
    step: z.literal('profile'),
    currentStage: z.literal('profile'),
  }),
  AgentSetupExpectedVersionSchema.extend({
    step: z.literal('review'),
    currentStage: z.literal('review'),
  }),
]);
export type UpdateAgentSetupRequest = z.infer<
  typeof UpdateAgentSetupRequestSchema
>;

export const DiscoverAgentSetupConversationsRequestSchema = z
  .object({
    query: z.string().trim().max(300).optional(),
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type DiscoverAgentSetupConversationsRequest = z.infer<
  typeof DiscoverAgentSetupConversationsRequestSchema
>;

export const CompleteAgentSetupRequestSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export type CompleteAgentSetupRequest = z.infer<
  typeof CompleteAgentSetupRequestSchema
>;
