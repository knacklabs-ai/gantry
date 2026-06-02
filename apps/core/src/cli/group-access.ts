import fs from 'fs';
import path from 'path';

import * as p from '@clack/prompts';

import { controlApiRequest } from './control-api.js';

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Render the one agent-wide view of skills + permissions. Authority is
 * agent-scoped and used in every conversation (DM and group) the agent is added
 * to, so this view is keyed by the agent, not by any conversation.
 */
function formatAgentAccess(agentId: string, access: unknown): string {
  const sources =
    isRecord(access) && isRecord(access.sources) ? access.sources : {};
  const lines = [
    `Agent: ${agentId}`,
    '(used in every conversation it is added to)',
  ];

  const skills = asArray(sources.skills);
  lines.push('', 'Skills:');
  if (skills.length === 0) lines.push('  (none)');
  for (const skill of skills) {
    if (!isRecord(skill)) continue;
    const name = String(skill.name ?? skill.id ?? '');
    const id = String(skill.id ?? '');
    lines.push(`  - ${name}${id && id !== name ? ` (${id})` : ''}`);
  }

  const mcpServers = asArray(sources.mcpServers);
  lines.push('', 'MCP servers:');
  if (mcpServers.length === 0) lines.push('  (none)');
  for (const server of mcpServers) {
    if (!isRecord(server)) continue;
    const id = String(server.id ?? '');
    const tools = asArray(server.tools)
      .map((t) => String(t ?? '').trim())
      .filter(Boolean);
    const scope = tools.length > 0 ? tools.join(', ') : 'all reviewed tools';
    lines.push(`  - ${id}  [${scope}]`);
  }

  const tools = asArray(sources.tools);
  if (tools.length > 0) {
    lines.push('', 'Tools:');
    for (const tool of tools) {
      if (!isRecord(tool)) continue;
      const id = String(tool.id ?? '');
      const kind = tool.kind ? ` (${String(tool.kind)})` : '';
      lines.push(`  - ${id}${kind}`);
    }
  }

  const selections = asArray(isRecord(access) ? access.selections : undefined);
  lines.push('', 'Permissions:');
  if (selections.length === 0) lines.push('  (none)');
  for (const selection of selections) {
    if (!isRecord(selection)) continue;
    const id = String(selection.id ?? '');
    const version = String(selection.version ?? 'builtin');
    lines.push(`  - ${id}@${version}`);
  }

  return lines.join('\n');
}

function agentIdFromSelector(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('agent:') ? trimmed : `agent:${trimmed}`;
}

export async function runAccess(
  runtimeHome: string,
  rest: string[],
): Promise<number> {
  const [action, selector, ...flags] = rest;
  if (!action || !selector || (action !== 'show' && action !== 'apply')) {
    p.log.error(
      'Usage: gantry agent access show <agent> [--json] | gantry agent access apply <agent> --file <path|->',
    );
    return 1;
  }
  const agentId = encodeURIComponent(agentIdFromSelector(selector));
  try {
    if (action === 'show') {
      const access = await controlApiRequest(runtimeHome, {
        method: 'GET',
        path: `/v1/agents/${agentId}/access`,
      });
      if (flags.includes('--json')) {
        console.log(JSON.stringify(access, null, 2));
        return 0;
      }
      p.note(
        formatAgentAccess(agentIdFromSelector(selector), access),
        'Agent skills & permissions',
      );
      return 0;
    }
    const fileIndex = flags.indexOf('--file');
    const filePath = fileIndex >= 0 ? flags[fileIndex + 1] : undefined;
    if (!filePath) {
      p.log.error('access apply requires --file <path|-> (use - for stdin).');
      return 1;
    }
    const raw =
      filePath === '-'
        ? fs.readFileSync(0, 'utf-8')
        : fs.readFileSync(path.resolve(filePath), 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      p.log.error(
        'Access document must be valid JSON with sources and selections.',
      );
      return 1;
    }
    if (!parsed || typeof parsed !== 'object') {
      p.log.error('Access document must be a JSON object.');
      return 1;
    }
    // The access PUT only accepts the writable subset; pick {sources, selections}
    // so `access show` output can be edited and re-applied directly (read-only
    // fields like agentId/toolAccess/updatedAt are stripped).
    const doc = parsed as { sources?: unknown; selections?: unknown };
    const body = {
      sources: doc.sources ?? { skills: [], mcpServers: [], tools: [] },
      ...(doc.selections !== undefined ? { selections: doc.selections } : {}),
    };
    const result = await controlApiRequest(runtimeHome, {
      method: 'PUT',
      path: `/v1/agents/${agentId}/access`,
      body,
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    p.log.error(`Agent access command failed: ${errorMessage(err)}`);
    return 1;
  }
}
