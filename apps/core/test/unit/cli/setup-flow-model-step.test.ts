import { afterEach, describe, expect, it, vi } from 'vitest';

function makeDraft(): any {
  return {
    agentName: 'Main Agent',
    selectedModel: 'opus',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@clack/prompts');
});

async function loadModelStep(selection: string) {
  const select = vi.fn(async () => selection);
  const text = vi.fn(async () => 'Main Agent');
  vi.doMock('@clack/prompts', () => ({
    isCancel: () => false,
    select,
    text,
  }));
  const { runModelStep } = await import('@core/cli/setup-flow-core-steps.js');
  return { runModelStep, select };
}

describe('setup model step', () => {
  it('keeps guided setup model selections in catalog alias space', async () => {
    const { runModelStep } = await loadModelStep('sonnet');
    const draft = makeDraft();

    const action = await runModelStep(draft);

    expect(action).toEqual({ type: 'next' });
    expect(draft.selectedModel).toBe('sonnet');
  });

  it('does not offer legacy opusplan as a setup model choice', async () => {
    const { runModelStep, select } = await loadModelStep('opus');

    await runModelStep(makeDraft());

    const options = select.mock.calls[0]?.[0]?.options ?? [];
    expect(
      options.map((option: { value: string }) => option.value),
    ).not.toContain('opusplan');
  });
});
