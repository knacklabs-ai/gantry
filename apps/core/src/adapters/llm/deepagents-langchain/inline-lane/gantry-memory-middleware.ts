import { SystemMessage } from '@langchain/core/messages';
import { createAgentMemoryMiddleware } from 'deepagents';
import type { Settings } from 'deepagents';

import type { ProviderInlineAgentLoopLane } from '../../inline-lane-dispatcher.js';

const NO_FILESYSTEM_SETTINGS: Settings = {
  projectRoot: null,
  userDeepagentsDir: '/gantry/memory-disabled',
  hasProject: false,
  getAgentDir: () => '/gantry/memory-disabled',
  ensureAgentDir: () => '/gantry/memory-disabled',
  getUserAgentMdPath: () => '/gantry/memory-disabled/agent.md',
  getProjectAgentMdPath: () => null,
  getUserSkillsDir: () => '/gantry/memory-disabled/skills',
  ensureUserSkillsDir: () => '/gantry/memory-disabled/skills',
  getProjectSkillsDir: () => null,
  ensureProjectSkillsDir: () => null,
  ensureProjectDeepagentsDir: () => null,
};

export function createGantryScopedMemoryMiddleware(input: {
  currentQuery: () => string;
  searchMemory(query: string): Promise<string>;
}): ReturnType<typeof createAgentMemoryMiddleware> {
  const base = createAgentMemoryMiddleware({
    settings: NO_FILESYSTEM_SETTINGS,
    assistantId: 'gantry',
  });

  const middleware = {
    ...base,
    beforeAgent: async () => ({
      userMemory: await input.searchMemory(input.currentQuery()),
    }),
    wrapModelCall: (
      request: GantryMemoryModelRequest,
      handler: GantryMemoryModelHandler,
    ) => handler(withGantryMemory(request, scopedMemoryText(request.state))),
  };
  return middleware as unknown as ReturnType<
    typeof createAgentMemoryMiddleware
  >;
}

export async function searchGantryScopedMemory(
  input: Parameters<ProviderInlineAgentLoopLane>[0],
  query: string,
  signal: AbortSignal,
): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return '';
  try {
    const result = await input.coreTools.execute(
      'memory_search',
      { query: trimmed },
      { signal },
    );
    if (result.isError) return '';
    const text = result.content
      .map((item) => (item.type === 'text' ? item.text : ''))
      .join('\n')
      .trim();
    return text === 'No relevant memories found.' ? '' : text;
  } catch {
    return '';
  }
}

interface GantryMemoryModelRequest {
  state?: unknown;
  systemMessage?: SystemMessage;
  systemPrompt?: string;
  [key: string]: unknown;
}

type GantryMemoryModelHandler = (request: GantryMemoryModelRequest) => unknown;

function scopedMemoryText(state: unknown): string {
  const value =
    state && typeof state === 'object'
      ? (state as { userMemory?: unknown }).userMemory
      : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function withGantryMemory<Request extends Record<string, unknown>>(
  request: Request,
  memory: string,
): Request {
  const section = [
    '<gantry_scoped_memory>',
    memory || '(No relevant Gantry memory returned.)',
    '</gantry_scoped_memory>',
    '',
    'Use memory_search for additional remembered context when useful.',
    'Use memory_save for durable preferences, facts, decisions, corrections, and constraints worth remembering.',
    'Gantry selects app, agent, conversation, thread, and user scope server-side.',
  ].join('\n');

  const systemMessage = request.systemMessage;
  if (SystemMessage.isInstance(systemMessage)) {
    return {
      ...request,
      systemMessage: systemMessage.concat(`\n\n${section}`),
    };
  }

  const systemPrompt =
    typeof request.systemPrompt === 'string' ? request.systemPrompt : '';
  return {
    ...request,
    systemPrompt: [systemPrompt.trim(), section].filter(Boolean).join('\n\n'),
  };
}
