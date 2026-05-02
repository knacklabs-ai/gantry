import { findModelByRunnerModel } from '../shared/model-catalog.js';
import type { AgentOutput } from './agent-spawn-types.js';
import { updateRuntimeModelStatus } from './model-status-store.js';

interface RuntimeModelStatusGroup {
  folder: string;
  agentConfig?: { model?: string | null } | null;
}

export function recordRuntimeModelUsage(input: {
  group: RuntimeModelStatusGroup;
  threadId: string | null;
  usage: NonNullable<AgentOutput['usage']>;
  usageEventId?: string;
  getDefaultModel: () => string | undefined;
}): void {
  const sessionModel = input.group.agentConfig?.model;
  const selectedModel = sessionModel || input.getDefaultModel();
  const billedModel = findModelByRunnerModel(input.usage.model);
  updateRuntimeModelStatus({
    scopeKey: input.group.folder,
    threadId: input.threadId,
    selectionSource: sessionModel ? 'session override' : 'chat default',
    modelAlias: billedModel?.recommendedAlias ?? selectedModel,
    model: billedModel ?? findModelByRunnerModel(selectedModel),
    usage: input.usage,
    usageKey: input.usageEventId,
  });
}
