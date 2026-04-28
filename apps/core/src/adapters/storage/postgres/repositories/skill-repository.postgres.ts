import { and, asc, desc, eq } from 'drizzle-orm';

import type { SkillCatalogRepository } from '../../../../domain/ports/repositories.js';
import type {
  AgentSkillBinding,
  ResolvedAgentSkillVersion,
  SkillAsset,
  SkillCatalogItem,
  SkillRegistryEvent,
  SkillVersion,
} from '../../../../domain/skills/skills.js';
import * as pgSchema from '../schema/schema.js';
import type { CanonicalDb } from './canonical-graph-repository.postgres.js';

function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJsonArray(value: unknown): never[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as never[]) : [];
  } catch {
    return [];
  }
}

export class PostgresSkillCatalogRepository implements SkillCatalogRepository {
  constructor(private readonly db: CanonicalDb) {}

  private mapSkill(row: typeof pgSchema.skillCatalogPostgres.$inferSelect) {
    return {
      id: row.id,
      appId: row.appId,
      name: row.name,
      description: row.description ?? undefined,
      source: row.source,
      status: row.status,
      version: row.version,
      promptRefs: parseJsonArray(row.promptRefsJson),
      toolIds: parseJsonArray(row.toolIdsJson),
      workflowRefs: parseJsonArray(row.workflowRefsJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } as unknown as SkillCatalogItem;
  }

  private mapSkillVersion(
    row: typeof pgSchema.skillVersionsPostgres.$inferSelect,
  ) {
    return {
      id: row.id,
      skillId: row.skillId,
      version: row.version,
      entrypoint: row.entrypoint,
      manifestJson: row.manifestJson,
      contentHash: row.contentHash,
      approvalStatus: row.approvalStatus,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    } as SkillVersion;
  }

  private mapSkillAsset(row: typeof pgSchema.skillAssetsPostgres.$inferSelect) {
    return {
      id: row.id,
      skillVersionId: row.skillVersionId,
      path: row.path,
      contentType: row.contentType,
      storageType: row.storageType,
      storageRef: row.storageRef,
      contentHash: row.contentHash,
      sizeBytes: row.sizeBytes,
    } as SkillAsset;
  }

  private mapAgentSkillBinding(
    row: typeof pgSchema.agentSkillBindingsPostgres.$inferSelect,
  ) {
    return {
      id: row.id,
      appId: row.appId,
      agentId: row.agentId,
      skillId: row.skillId,
      skillVersionId: row.skillVersionId ?? undefined,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } as AgentSkillBinding;
  }

  async listSkills(appId: SkillCatalogItem['appId']) {
    const rows = await this.db
      .select()
      .from(pgSchema.skillCatalogPostgres)
      .where(eq(pgSchema.skillCatalogPostgres.appId, appId))
      .orderBy(asc(pgSchema.skillCatalogPostgres.name));
    return rows.map((row) => this.mapSkill(row));
  }

  async getSkill(id: SkillCatalogItem['id']): Promise<SkillCatalogItem | null> {
    const rows = await this.db
      .select()
      .from(pgSchema.skillCatalogPostgres)
      .where(eq(pgSchema.skillCatalogPostgres.id, id))
      .limit(1);
    return rows[0] ? this.mapSkill(rows[0]) : null;
  }

  async saveSkill(item: SkillCatalogItem): Promise<void> {
    await this.db
      .insert(pgSchema.skillCatalogPostgres)
      .values({
        id: item.id,
        appId: item.appId,
        name: item.name,
        description: item.description ?? null,
        source: item.source,
        status: item.status,
        version: item.version,
        promptRefsJson: encodeJson(item.promptRefs),
        toolIdsJson: encodeJson(item.toolIds),
        workflowRefsJson: encodeJson(item.workflowRefs),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })
      .onConflictDoUpdate({
        target: pgSchema.skillCatalogPostgres.id,
        set: {
          name: item.name,
          description: item.description ?? null,
          source: item.source,
          status: item.status,
          version: item.version,
          promptRefsJson: encodeJson(item.promptRefs),
          toolIdsJson: encodeJson(item.toolIds),
          workflowRefsJson: encodeJson(item.workflowRefs),
          updatedAt: item.updatedAt,
        },
      });
  }

  async updateSkill(input: {
    appId: SkillCatalogItem['appId'];
    id: SkillCatalogItem['id'];
    patch: Partial<Pick<SkillCatalogItem, 'name' | 'description' | 'status'>>;
    updatedAt: string;
  }): Promise<SkillCatalogItem | null> {
    const existing = await this.getSkill(input.id);
    if (!existing || existing.appId !== input.appId) return null;
    const rows = await this.db
      .update(pgSchema.skillCatalogPostgres)
      .set({
        name: input.patch.name ?? existing.name,
        description:
          input.patch.description === undefined
            ? (existing.description ?? null)
            : (input.patch.description ?? null),
        status: input.patch.status ?? existing.status,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(pgSchema.skillCatalogPostgres.id, input.id),
          eq(pgSchema.skillCatalogPostgres.appId, input.appId),
        ),
      )
      .returning();
    return rows[0] ? this.mapSkill(rows[0]) : null;
  }

  async saveSkillVersion(
    version: SkillVersion,
    assets: SkillAsset[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(pgSchema.skillVersionsPostgres)
        .values({
          id: version.id,
          skillId: version.skillId,
          version: version.version,
          entrypoint: version.entrypoint,
          manifestJson: version.manifestJson,
          contentHash: version.contentHash,
          approvalStatus: version.approvalStatus,
          createdBy: version.createdBy,
          createdAt: version.createdAt,
        })
        .onConflictDoNothing();
      if (assets.length > 0) {
        await tx
          .insert(pgSchema.skillAssetsPostgres)
          .values(
            assets.map((asset) => ({
              id: asset.id,
              skillVersionId: asset.skillVersionId,
              path: asset.path,
              contentType: asset.contentType,
              storageType: asset.storageType,
              storageRef: asset.storageRef,
              contentHash: asset.contentHash,
              sizeBytes: asset.sizeBytes,
            })),
          )
          .onConflictDoNothing();
      }
    });
  }

  async getSkillVersion(id: SkillVersion['id']): Promise<SkillVersion | null> {
    const rows = await this.db
      .select()
      .from(pgSchema.skillVersionsPostgres)
      .where(eq(pgSchema.skillVersionsPostgres.id, id))
      .limit(1);
    return rows[0] ? this.mapSkillVersion(rows[0]) : null;
  }

  async listSkillVersions(
    skillId: SkillCatalogItem['id'],
  ): Promise<SkillVersion[]> {
    const rows = await this.db
      .select()
      .from(pgSchema.skillVersionsPostgres)
      .where(eq(pgSchema.skillVersionsPostgres.skillId, skillId))
      .orderBy(desc(pgSchema.skillVersionsPostgres.createdAt));
    return rows.map((row) => this.mapSkillVersion(row));
  }

  async listSkillAssets(
    skillVersionId: SkillVersion['id'],
  ): Promise<SkillAsset[]> {
    const rows = await this.db
      .select()
      .from(pgSchema.skillAssetsPostgres)
      .where(eq(pgSchema.skillAssetsPostgres.skillVersionId, skillVersionId))
      .orderBy(asc(pgSchema.skillAssetsPostgres.path));
    return rows.map((row) => this.mapSkillAsset(row));
  }

  async updateSkillVersionApproval(input: {
    skillId: SkillCatalogItem['id'];
    versionId: SkillVersion['id'];
    approvalStatus: SkillVersion['approvalStatus'];
  }): Promise<SkillVersion | null> {
    const rows = await this.db
      .update(pgSchema.skillVersionsPostgres)
      .set({ approvalStatus: input.approvalStatus })
      .where(
        and(
          eq(pgSchema.skillVersionsPostgres.id, input.versionId),
          eq(pgSchema.skillVersionsPostgres.skillId, input.skillId),
        ),
      )
      .returning();
    return rows[0] ? this.mapSkillVersion(rows[0]) : null;
  }

  async saveAgentSkillBinding(binding: AgentSkillBinding): Promise<void> {
    await this.db
      .insert(pgSchema.agentSkillBindingsPostgres)
      .values({
        id: binding.id,
        appId: binding.appId,
        agentId: binding.agentId,
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId ?? null,
        status: binding.status,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          pgSchema.agentSkillBindingsPostgres.agentId,
          pgSchema.agentSkillBindingsPostgres.skillId,
        ],
        set: {
          skillVersionId: binding.skillVersionId ?? null,
          status: binding.status,
          updatedAt: binding.updatedAt,
        },
      });
  }

  async getAgentSkillBinding(input: {
    appId: AgentSkillBinding['appId'];
    agentId: AgentSkillBinding['agentId'];
    skillId: SkillCatalogItem['id'];
  }): Promise<AgentSkillBinding | null> {
    const rows = await this.db
      .select()
      .from(pgSchema.agentSkillBindingsPostgres)
      .where(
        and(
          eq(pgSchema.agentSkillBindingsPostgres.appId, input.appId),
          eq(pgSchema.agentSkillBindingsPostgres.agentId, input.agentId),
          eq(pgSchema.agentSkillBindingsPostgres.skillId, input.skillId),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapAgentSkillBinding(rows[0]) : null;
  }

  async listAgentSkillBindings(input: {
    appId: AgentSkillBinding['appId'];
    agentId: AgentSkillBinding['agentId'];
  }): Promise<AgentSkillBinding[]> {
    const rows = await this.db
      .select()
      .from(pgSchema.agentSkillBindingsPostgres)
      .where(
        and(
          eq(pgSchema.agentSkillBindingsPostgres.appId, input.appId),
          eq(pgSchema.agentSkillBindingsPostgres.agentId, input.agentId),
        ),
      )
      .orderBy(asc(pgSchema.agentSkillBindingsPostgres.skillId));
    return rows.map((row) => this.mapAgentSkillBinding(row));
  }

  async disableAgentSkillBinding(input: {
    appId: AgentSkillBinding['appId'];
    agentId: AgentSkillBinding['agentId'];
    skillId: SkillCatalogItem['id'];
    updatedAt: string;
  }): Promise<AgentSkillBinding | null> {
    const rows = await this.db
      .update(pgSchema.agentSkillBindingsPostgres)
      .set({ status: 'disabled', updatedAt: input.updatedAt })
      .where(
        and(
          eq(pgSchema.agentSkillBindingsPostgres.appId, input.appId),
          eq(pgSchema.agentSkillBindingsPostgres.agentId, input.agentId),
          eq(pgSchema.agentSkillBindingsPostgres.skillId, input.skillId),
        ),
      )
      .returning();
    return rows[0] ? this.mapAgentSkillBinding(rows[0]) : null;
  }

  async resolveEnabledSkillVersionsForAgent(input: {
    appId: AgentSkillBinding['appId'];
    agentId: AgentSkillBinding['agentId'];
  }): Promise<ResolvedAgentSkillVersion[]> {
    const bindings = await this.listAgentSkillBindings(input);
    const resolved: ResolvedAgentSkillVersion[] = [];
    for (const binding of bindings) {
      if (binding.status !== 'active') continue;
      const skill = await this.getSkill(binding.skillId);
      if (!skill || skill.appId !== input.appId || skill.status !== 'active') {
        continue;
      }
      const versions = binding.skillVersionId
        ? [await this.getSkillVersion(binding.skillVersionId)].filter(
            (version): version is SkillVersion => Boolean(version),
          )
        : await this.listSkillVersions(binding.skillId);
      const version = versions.find(
        (candidate) => candidate.approvalStatus === 'approved',
      );
      if (!version) continue;
      const assets = await this.listSkillAssets(version.id);
      resolved.push({ skill, version, assets });
    }
    return resolved;
  }

  async recordSkillRegistryEvent(event: SkillRegistryEvent): Promise<void> {
    await this.db.insert(pgSchema.skillRegistryEventsPostgres).values({
      id: event.id,
      appId: event.appId,
      eventType: event.eventType,
      skillId: event.skillId ?? null,
      skillVersionId: event.skillVersionId ?? null,
      agentId: event.agentId ?? null,
      actorRef: event.actorRef ?? null,
      payloadJson: encodeJson(event.payload ?? {}),
      createdAt: event.createdAt,
    });
  }
}
