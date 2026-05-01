import {
  findModelByRunnerModel,
  resolveModelSelection,
  type ModelCatalogEntry,
} from '../shared/model-catalog.js';

export interface ModelStatusSelectionUpdate {
  selectionSource: string;
  modelAlias?: string;
  model?: ModelCatalogEntry;
}

export function defaultModelStatusSelection(
  defaultModel: string | undefined,
): ModelStatusSelectionUpdate {
  const resolved = defaultModel
    ? resolveModelSelection(defaultModel)
    : undefined;
  const model = resolved?.ok
    ? resolved.entry
    : defaultModel
      ? findModelByRunnerModel(defaultModel)
      : undefined;
  return {
    selectionSource: 'chat default',
    modelAlias: resolved?.ok ? resolved.alias : model?.recommendedAlias,
    model,
  };
}
