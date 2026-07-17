import { z } from 'zod';

import type { RuntimeApiTransport } from '../../lib/api/runtime-transport';

const brainStatusSchema = z.object({
  status: z.object({
    pages: z.number().int().nonnegative(),
    channelPages: z.number().int().nonnegative(),
    dreamPages: z.number().int().nonnegative(),
    entities: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    dreamDecisions: z.number().int().nonnegative(),
    lastDreamCursor: z.string().nullable(),
    readyEmbeddings: z.number().int().nonnegative(),
    pendingEmbeddings: z.number().int().nonnegative(),
    harvestEnabledConversations: z.number().int().nonnegative(),
  }),
});

const memoryItemSchema = z.object({
  id: z.string(),
  appId: z.string(),
  agentId: z.string().nullable().optional(),
  subjectType: z.string(),
  subjectId: z.string(),
  kind: z.enum([
    'preference',
    'decision',
    'fact',
    'correction',
    'constraint',
    'reference',
    'procedure',
  ]),
  key: z.string(),
  value: z.string(),
  why: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  isPinned: z.boolean(),
  version: z.number().int(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const memoryListSchema = z.object({ memories: z.array(memoryItemSchema) });
const memorySearchSchema = z.object({
  results: z.array(
    z.union([
      memoryItemSchema,
      z.object({
        item: memoryItemSchema,
        score: z.number(),
      }),
    ]),
  ),
});

const dreamingRunSchema = z.object({
  runId: z.string(),
  phase: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
});

const dreamingStatusSchema = z.object({ runs: z.array(dreamingRunSchema) });
const dreamingTriggerSchema = z.object({
  run: z.record(z.string(), z.unknown()),
});

export type MemoryItem = z.infer<typeof memoryItemSchema>;
export type MemoryDashboard = Awaited<ReturnType<typeof loadMemoryDashboard>>;

export const memoryQueryKeys = {
  all: ['memory'] as const,
  dashboard: () => [...memoryQueryKeys.all, 'dashboard'] as const,
  list: (query: string) => [...memoryQueryKeys.all, 'list', query] as const,
};

export async function loadMemoryDashboard(transport: RuntimeApiTransport) {
  const [brain, memories, dreaming] = await Promise.all([
    transport.request({ path: '/brain/status', schema: brainStatusSchema }),
    transport.request({
      path: '/memory',
      query: { limit: 100 },
      schema: memoryListSchema,
    }),
    transport.request({
      path: '/memory/dreaming/status',
      schema: dreamingStatusSchema,
    }),
  ]);
  return {
    brain: brain.status,
    loadedMemoryCount: memories.memories.length,
    memoryKinds: countKinds(memories.memories),
    dreamingRuns: dreaming.runs,
  };
}

export async function loadMemories(
  transport: RuntimeApiTransport,
  query: string,
): Promise<MemoryItem[]> {
  if (!query.trim()) {
    return (
      await transport.request({
        path: '/memory',
        query: { limit: 100 },
        schema: memoryListSchema,
      })
    ).memories;
  }
  const result = await transport.request({
    path: '/memory/search',
    method: 'POST',
    body: { query: query.trim(), limit: 100 },
    schema: memorySearchSchema,
  });
  return result.results.map((item) => ('item' in item ? item.item : item));
}

export function triggerMemoryDreaming(transport: RuntimeApiTransport) {
  return transport.request({
    path: '/memory/dreaming/trigger',
    method: 'POST',
    body: { phase: 'all' },
    schema: dreamingTriggerSchema,
  });
}

function countKinds(items: MemoryItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, {});
}
