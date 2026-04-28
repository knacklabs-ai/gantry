import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  CreateSkillRequestSchema,
  CreateSkillVersionRequestSchema,
  UpdateAgentSkillBindingRequestSchema,
  UpdateSkillRequestSchema,
} from '@myclaw/contracts';

import { NodeSkillRegistryCrypto } from '../../../adapters/artifacts/skills/node-skill-registry-crypto.js';
import { getRuntimeStorage } from '../../../adapters/storage/postgres/runtime-store.js';
import { SkillRegistryService } from '../../../application/skills/skill-registry-service.js';
import { ApplicationError } from '../../../application/common/application-error.js';
import type { AgentId } from '../../../domain/agent/agent.js';
import type { AppId } from '../../../domain/app/app.js';
import type {
  AgentSkillBinding,
  SkillAsset,
  SkillCatalogItem,
  SkillId,
  SkillVersion,
  SkillVersionId,
} from '../../../domain/skills/skills.js';
import { canAccessApp } from '../app-identity.js';
import {
  authorizeControlRequest,
  type ControlRouteContext,
} from '../handler-context.js';
import { readJson, sendError, sendJson } from '../http.js';

function service() {
  return new SkillRegistryService(
    getRuntimeStorage().repositories.skills,
    getRuntimeStorage().skillAssets,
    new NodeSkillRegistryCrypto(),
  );
}

function appIdFrom(input: { appId?: string }, fallback: string): AppId {
  return (input.appId?.trim() || fallback) as AppId;
}

function assertAppAccess(
  res: ServerResponse,
  appId: AppId,
  auth: ReturnType<typeof authorizeControlRequest>,
): boolean {
  if (!auth) return false;
  if (!canAccessApp(auth, appId)) {
    sendError(res, 403, 'FORBIDDEN', 'API key cannot access this app');
    return false;
  }
  return true;
}

function sendApplicationError(res: ServerResponse, error: unknown): boolean {
  if (!(error instanceof ApplicationError)) return false;
  if (error.code === 'NOT_FOUND')
    sendError(res, 404, 'NOT_FOUND', error.message);
  else if (error.code === 'CONFLICT')
    sendError(res, 409, 'CONFLICT', error.message);
  else if (error.code === 'INVALID_REQUEST') {
    sendError(res, 400, 'INVALID_REQUEST', error.message);
  } else {
    sendError(res, 500, error.code, error.message);
  }
  return true;
}

function skillToResponse(skill: SkillCatalogItem) {
  return {
    id: skill.id,
    appId: skill.appId,
    name: skill.name,
    description: skill.description ?? null,
    source: skill.source,
    status: skill.status,
    version: skill.version,
    promptRefs: skill.promptRefs,
    toolIds: skill.toolIds,
    workflowRefs: skill.workflowRefs,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function versionToResponse(version: SkillVersion) {
  return { ...version };
}

function assetToResponse(asset: SkillAsset) {
  return { ...asset };
}

function bindingToResponse(binding: AgentSkillBinding) {
  return { ...binding };
}

function parseSkillRoute(pathname: string):
  | { kind: 'skill'; skillId: string }
  | { kind: 'versions'; skillId: string }
  | {
      kind: 'version-action';
      skillId: string;
      versionId: string;
      action: string;
    }
  | null {
  let match = /^\/v1\/skills\/([^/]+)$/.exec(pathname);
  if (match) return { kind: 'skill', skillId: decodeURIComponent(match[1]!) };
  match = /^\/v1\/skills\/([^/]+)\/versions$/.exec(pathname);
  if (match)
    return { kind: 'versions', skillId: decodeURIComponent(match[1]!) };
  match = /^\/v1\/skills\/([^/]+)\/versions\/([^/]+)\/(approve|reject)$/.exec(
    pathname,
  );
  if (match) {
    return {
      kind: 'version-action',
      skillId: decodeURIComponent(match[1]!),
      versionId: decodeURIComponent(match[2]!),
      action: match[3]!,
    };
  }
  return null;
}

function parseAgentSkillRoute(
  pathname: string,
):
  | { kind: 'list'; agentId: string }
  | { kind: 'binding'; agentId: string; skillId: string }
  | null {
  let match = /^\/v1\/agents\/([^/]+)\/skills$/.exec(pathname);
  if (match) return { kind: 'list', agentId: decodeURIComponent(match[1]!) };
  match = /^\/v1\/agents\/([^/]+)\/skills\/([^/]+)$/.exec(pathname);
  if (match) {
    return {
      kind: 'binding',
      agentId: decodeURIComponent(match[1]!),
      skillId: decodeURIComponent(match[2]!),
    };
  }
  return null;
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ControlRouteContext,
  url: URL,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/v1/skills' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:read']);
    if (!auth) return true;
    const appId = (url.searchParams.get('appId') || auth.appId) as AppId;
    if (!assertAppAccess(res, appId, auth)) return true;
    const skills = await service().listSkills({ appId });
    sendJson(res, 200, { skills: skills.map(skillToResponse) });
    return true;
  }

  if (pathname === '/v1/skills' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:write']);
    if (!auth) return true;
    const parsed = CreateSkillRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_REQUEST', 'Invalid skill request');
      return true;
    }
    const appId = appIdFrom(parsed.data, auth.appId);
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      const skill = await service().createSkill({
        ...parsed.data,
        appId,
        actorRef: auth.kid,
      });
      sendJson(res, 201, skillToResponse(skill));
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  const skillRoute = parseSkillRoute(pathname);
  if (skillRoute?.kind === 'skill' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:read']);
    if (!auth) return true;
    const appId = (url.searchParams.get('appId') || auth.appId) as AppId;
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      const skill = await service().getSkill({
        appId,
        skillId: skillRoute.skillId as SkillId,
      });
      sendJson(res, 200, skillToResponse(skill));
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (skillRoute?.kind === 'skill' && req.method === 'PATCH') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:write']);
    if (!auth) return true;
    const parsed = UpdateSkillRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_REQUEST', 'Invalid skill update request');
      return true;
    }
    const appId = appIdFrom(parsed.data, auth.appId);
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      const skill = await service().updateSkill({
        appId,
        skillId: skillRoute.skillId as SkillId,
        patch: {
          name: parsed.data.name,
          description: parsed.data.description ?? undefined,
          status: parsed.data.status,
        },
      });
      sendJson(res, 200, skillToResponse(skill));
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (skillRoute?.kind === 'versions' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:read']);
    if (!auth) return true;
    const appId = (url.searchParams.get('appId') || auth.appId) as AppId;
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      await service().getSkill({
        appId,
        skillId: skillRoute.skillId as SkillId,
      });
      const versions =
        await getRuntimeStorage().repositories.skills.listSkillVersions(
          skillRoute.skillId as SkillId,
        );
      sendJson(res, 200, { versions: versions.map(versionToResponse) });
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (skillRoute?.kind === 'versions' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:write']);
    if (!auth) return true;
    const parsed = CreateSkillVersionRequestSchema.safeParse(
      await readJson(req),
    );
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_REQUEST', 'Invalid skill version request');
      return true;
    }
    const appId = appIdFrom(parsed.data, auth.appId);
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      const created = await service().createSkillVersion({
        appId,
        skillId: skillRoute.skillId as SkillId,
        version: parsed.data.version,
        entrypoint: parsed.data.entrypoint,
        manifestJson: parsed.data.manifestJson,
        createdBy: parsed.data.createdBy ?? auth.kid,
        assets: parsed.data.assets.map((asset) => ({
          path: asset.path,
          contentType: asset.contentType,
          content: Buffer.from(asset.contentBase64, 'base64'),
        })),
      });
      sendJson(res, 201, {
        version: versionToResponse(created.version),
        assets: created.assets.map(assetToResponse),
      });
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (skillRoute?.kind === 'version-action' && req.method === 'POST') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:write']);
    if (!auth) return true;
    const body = (await readJson(req)) as { appId?: string };
    const appId = appIdFrom(body, auth.appId);
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      const input = {
        appId,
        skillId: skillRoute.skillId as SkillId,
        versionId: skillRoute.versionId as SkillVersionId,
        actorRef: auth.kid,
      };
      const version =
        skillRoute.action === 'approve'
          ? await service().approveSkillVersion(input)
          : await service().rejectSkillVersion(input);
      sendJson(res, 200, versionToResponse(version));
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  const agentRoute = parseAgentSkillRoute(pathname);
  if (agentRoute?.kind === 'list' && req.method === 'GET') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:read']);
    if (!auth) return true;
    const appId = (url.searchParams.get('appId') || auth.appId) as AppId;
    if (!assertAppAccess(res, appId, auth)) return true;
    const bindings = await service().listAgentSkills({
      appId,
      agentId: agentRoute.agentId as AgentId,
    });
    sendJson(res, 200, { skills: bindings.map(bindingToResponse) });
    return true;
  }

  if (agentRoute?.kind === 'binding' && req.method === 'PUT') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:write']);
    if (!auth) return true;
    const parsed = UpdateAgentSkillBindingRequestSchema.safeParse(
      await readJson(req),
    );
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_REQUEST', 'Invalid skill binding request');
      return true;
    }
    const appId = appIdFrom(parsed.data, auth.appId);
    if (!assertAppAccess(res, appId, auth)) return true;
    try {
      const binding = await service().bindSkillToAgent({
        appId,
        agentId: agentRoute.agentId as AgentId,
        skillId: agentRoute.skillId as SkillId,
        skillVersionId: parsed.data.skillVersionId as
          | SkillVersionId
          | undefined,
        actorRef: auth.kid,
      });
      sendJson(res, 200, bindingToResponse(binding));
    } catch (error) {
      if (!sendApplicationError(res, error)) throw error;
    }
    return true;
  }

  if (agentRoute?.kind === 'binding' && req.method === 'DELETE') {
    const auth = authorizeControlRequest(req, res, ctx.keys, ['skills:write']);
    if (!auth) return true;
    const appId = (url.searchParams.get('appId') || auth.appId) as AppId;
    if (!assertAppAccess(res, appId, auth)) return true;
    const binding = await service().unbindSkillFromAgent({
      appId,
      agentId: agentRoute.agentId as AgentId,
      skillId: agentRoute.skillId as SkillId,
      actorRef: auth.kid,
    });
    sendJson(res, 200, { disabled: Boolean(binding), binding });
    return true;
  }

  return false;
}
