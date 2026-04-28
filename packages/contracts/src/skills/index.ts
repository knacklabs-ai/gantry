import { z } from 'zod';

import {
  ContractMetadataSchema,
  IsoDateTimeSchema,
} from '../contract-primitives.js';

export const SkillCatalogItemResponseSchema = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  source: z.enum(['bundled', 'admin_uploaded', 'marketplace', 'system']),
  status: z.enum(['active', 'disabled', 'deprecated']),
  version: z.string(),
  promptRefs: z.array(z.string()),
  toolIds: z.array(z.string()),
  workflowRefs: z.array(z.string()),
  setupRefs: z.array(z.string()).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  metadata: ContractMetadataSchema.optional(),
});
export type SkillCatalogItemResponse = z.infer<
  typeof SkillCatalogItemResponseSchema
>;

export const SkillVersionResponseSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  version: z.string(),
  entrypoint: z.string(),
  manifestJson: z.string(),
  contentHash: z.string(),
  approvalStatus: z.enum(['draft', 'approved', 'rejected']),
  createdBy: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type SkillVersionResponse = z.infer<typeof SkillVersionResponseSchema>;

export const SkillAssetResponseSchema = z.object({
  id: z.string(),
  skillVersionId: z.string(),
  path: z.string(),
  contentType: z.string(),
  storageType: z.enum(['local-filesystem', 'object-store']),
  storageRef: z.string(),
  contentHash: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type SkillAssetResponse = z.infer<typeof SkillAssetResponseSchema>;

export const CreateSkillRequestSchema = z.object({
  appId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  source: z
    .enum(['bundled', 'admin_uploaded', 'marketplace', 'system'])
    .optional(),
});
export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>;

export const UpdateSkillRequestSchema = z.object({
  appId: z.string().optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'disabled', 'deprecated']).optional(),
});
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>;

export const CreateSkillVersionRequestSchema = z.object({
  appId: z.string().optional(),
  version: z.string().optional(),
  entrypoint: z.string().optional(),
  manifestJson: z.string().optional(),
  createdBy: z.string().optional(),
  assets: z.array(
    z.object({
      path: z.string().min(1),
      contentType: z.string().optional(),
      contentBase64: z.string().min(1),
    }),
  ),
});
export type CreateSkillVersionRequest = z.infer<
  typeof CreateSkillVersionRequestSchema
>;

export const UpdateAgentSkillBindingRequestSchema = z.object({
  appId: z.string().optional(),
  skillVersionId: z.string().optional(),
});
export type UpdateAgentSkillBindingRequest = z.infer<
  typeof UpdateAgentSkillBindingRequestSchema
>;
