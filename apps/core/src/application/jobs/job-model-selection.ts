import {
  resolveModelProfileSelection,
  resolveModelSelection,
} from '../../shared/model-catalog.js';
import { ApplicationError } from '../common/application-error.js';

export function resolveOptionalJobModel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Job model must be a supported model alias.',
    );
  }
  const resolved = resolveModelSelection(value);
  if (!resolved.ok) {
    throw new ApplicationError('INVALID_REQUEST', resolved.message);
  }
  return resolved.alias;
}

function hasModelValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function resolveRequestedJobModel(
  modelAlias: unknown,
  modelProfileId: unknown,
): string | undefined {
  const hasAlias = hasModelValue(modelAlias);
  const hasProfile = hasModelValue(modelProfileId);
  if (hasAlias && hasProfile) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Use either modelAlias or modelProfileId, not both.',
    );
  }
  if (hasAlias) return resolveOptionalJobModel(modelAlias);
  if (!hasProfile) return undefined;
  if (typeof modelProfileId !== 'string') {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Job model profile must be a supported model profile ID.',
    );
  }
  const resolved = resolveModelProfileSelection(modelProfileId);
  if (!resolved.ok) {
    throw new ApplicationError('INVALID_REQUEST', resolved.message);
  }
  return resolved.alias;
}

export function resolveRequestedJobModelPatch(
  modelAlias: unknown,
  modelProfileId: unknown,
): { specified: boolean; model?: string | null } {
  const aliasSpecified = modelAlias !== undefined;
  const profileSpecified = modelProfileId !== undefined;
  if (aliasSpecified && profileSpecified) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Use either modelAlias or modelProfileId, not both.',
    );
  }
  if (!aliasSpecified && !profileSpecified) return { specified: false };
  const value = aliasSpecified ? modelAlias : modelProfileId;
  if (value === null) return { specified: true, model: null };
  if (value === '') {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Use null to clear a job model.',
    );
  }
  if (aliasSpecified) {
    return {
      specified: true,
      model: resolveOptionalJobModel(value),
    };
  }
  if (typeof value !== 'string') {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Job model profile must be a supported model profile ID.',
    );
  }
  const resolved = resolveModelProfileSelection(value);
  if (!resolved.ok) {
    throw new ApplicationError('INVALID_REQUEST', resolved.message);
  }
  return { specified: true, model: resolved.alias };
}
