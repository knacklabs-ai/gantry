import type { IncomingMessage, ServerResponse } from 'node:http';

import { SetAgentModelRequestSchema } from '@gantry/contracts';

import { getRuntimeStorage } from '../../../adapters/storage/postgres/runtime-store.js';
import { folderForAgentId } from '../../../domain/agent/agent-folder-id.js';
import type { Agent, AgentId } from '../../../domain/agent/agent.js';
import type { AppId } from '../../../domain/app/app.js';
import { resolveModelSelectionForWorkload } from '../../../shared/model-catalog.js';
import {
  authorizeControlRequest,
  type ControlRouteContext,
} from '../handler-context.js';
import { readJson, sendError, sendJson } from '../http.js';

export async function handleAgentModelRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  ctx: ControlRouteContext;
  pathname: string;
  agentResponse: (agent: Agent) => Record<string, unknown>;
}): Promise<boolean> {
  const match = input.pathname.match(/^\/v1\/agents\/([^/]+)\/model$/);
  if (!match || input.req.method !== 'PATCH') return false;

  const auth = authorizeControlRequest(input.req, input.res, input.ctx.keys, [
    'agents:admin',
  ]);
  if (!auth) return true;
  const parsed = SetAgentModelRequestSchema.safeParse(
    await readJson(input.req),
  );
  if (!parsed.success) {
    sendError(input.res, 400, 'INVALID_REQUEST', 'Invalid agent model');
    return true;
  }
  const resolved = resolveModelSelectionForWorkload(
    parsed.data.modelAlias,
    'chat',
  );
  if (!resolved.ok) {
    sendError(input.res, 400, 'INVALID_REQUEST', resolved.message);
    return true;
  }
  const agentId = decodeURIComponent(match[1]) as AgentId;
  const agent = await getRuntimeStorage().repositories.agents.getAgent(agentId);
  if (!agent || agent.appId !== auth.appId) {
    sendError(input.res, 404, 'NOT_FOUND', 'Agent not found');
    return true;
  }
  const folder = folderForAgentId(agent.id);
  if (!folder) {
    sendError(
      input.res,
      400,
      'INVALID_REQUEST',
      'Agent has no settings folder',
    );
    return true;
  }
  await input.ctx.agentSettings.writeAgentModelSetting({
    runtimeHome: input.ctx.runtimeHome,
    appId: auth.appId as AppId,
    folder,
    name: agent.name,
    modelAlias: resolved.alias,
  });
  sendJson(input.res, 200, {
    ...input.agentResponse(agent),
    modelAlias: resolved.alias,
  });
  return true;
}
