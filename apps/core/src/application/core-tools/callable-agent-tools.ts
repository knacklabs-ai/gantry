import {
  agentIdForFolder,
  folderForAgentId,
} from '../../domain/agent/agent-folder-id.js';
import type { Agent } from '../../domain/agent/agent.js';
import { sha256Base64Url } from '../../shared/stable-hash.js';
import type {
  CoreTaskLifecycleBackend,
  CoreTaskLifecycleResult,
} from './task-lifecycle.js';

export const CALLABLE_AGENT_TOOL_PREFIX = 'delegate_to_';
export const CALLABLE_AGENT_SYNC_WAIT_TIMEOUT_MS = 60_000;
export const CALLABLE_AGENT_SYNC_WAIT_MAX_MS = 60_000;

export interface CallableAgentToolManifestEntry {
  toolName: string;
  targetAgentId: string;
  displayName: string;
}

export function projectCallableAgentTools(input: {
  agents: readonly Agent[];
  callerAppId: string;
  callerAgentId: string;
  callerFolder: string;
  delegates: readonly string[];
  toolPolicyRules?: readonly string[];
  parentTaskId?: string | null;
}): CallableAgentToolManifestEntry[] {
  if (
    input.parentTaskId != null ||
    !input.toolPolicyRules?.includes('AgentDelegation') ||
    input.delegates.length === 0
  ) {
    return [];
  }
  const callerIds = new Set([
    input.callerAgentId,
    String(agentIdForFolder(input.callerFolder)),
  ]);
  const byIdentity = new Map<string, Agent>();
  for (const agent of input.agents) {
    if (
      String(agent.appId) !== input.callerAppId ||
      agent.status !== 'active' ||
      callerIds.has(String(agent.id))
    ) {
      continue;
    }
    byIdentity.set(String(agent.id), agent);
    const folder = folderForAgentId(agent.id);
    if (folder) byIdentity.set(folder, agent);
  }
  const seen = new Set<string>();
  return input.delegates.flatMap((delegate) => {
    const agent =
      byIdentity.get(delegate) ??
      byIdentity.get(String(agentIdForFolder(delegate)));
    if (!agent || seen.has(String(agent.id))) return [];
    seen.add(String(agent.id));
    return [
      {
        toolName: immutableToolName(String(agent.id)),
        targetAgentId: String(agent.id),
        displayName: agent.name.replace(/\s+/g, ' ').trim(),
      },
    ];
  });
}

export async function dispatchCallableAgentTool(input: {
  args: Record<string, unknown>;
  entry: CallableAgentToolManifestEntry;
  backend: CoreTaskLifecycleBackend;
  revalidate(entry: CallableAgentToolManifestEntry): Promise<boolean>;
}): Promise<CoreTaskLifecycleResult> {
  if (Object.prototype.hasOwnProperty.call(input.args, 'targetAgentId')) {
    return {
      ok: false,
      message: 'Callable agent tools do not accept targetAgentId.',
      code: 'invalid_request',
    };
  }
  if (!(await input.revalidate(input.entry))) {
    return {
      ok: false,
      message: 'Callable agent target is no longer permitted.',
      code: 'forbidden',
    };
  }
  return input.backend.delegate_task({
    ...input.args,
    targetAgentId: input.entry.targetAgentId,
    syncWaitTimeoutMs:
      typeof input.args.syncWaitTimeoutMs === 'number'
        ? input.args.syncWaitTimeoutMs
        : CALLABLE_AGENT_SYNC_WAIT_TIMEOUT_MS,
  });
}

function immutableToolName(agentId: string): string {
  const identity = folderForAgentId(agentId as Agent['id']) ?? agentId;
  const stem =
    identity
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 8) || 'agent';
  const digest = sha256Base64Url(agentId);
  return `${stem}_${digest}`;
}
