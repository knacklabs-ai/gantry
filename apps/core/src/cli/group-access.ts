import fs from 'fs';
import path from 'path';

import * as p from '@clack/prompts';

import { controlApiRequest } from './control-api.js';

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

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
      'Usage: gantry agent access show <agent> | gantry agent access apply <agent> --file <path|->',
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
      console.log(JSON.stringify(access, null, 2));
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
