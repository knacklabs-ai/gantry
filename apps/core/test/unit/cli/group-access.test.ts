import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@core/cli/control-api.js');
  vi.doUnmock('@clack/prompts');
});

function mockClack() {
  vi.doMock('@clack/prompts', () => ({
    log: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn() },
  }));
}

describe('agent access CLI (runAccess)', () => {
  it('returns 1 for an unknown action', async () => {
    mockClack();
    const controlApiRequest = vi.fn();
    vi.doMock('@core/cli/control-api.js', () => ({ controlApiRequest }));
    const { runAccess } = await import('@core/cli/group-access.js');
    expect(await runAccess('/tmp/gantry-access-test', ['bogus', 'a1'])).toBe(1);
    expect(controlApiRequest).not.toHaveBeenCalled();
  });

  it('GET /access for show with a normalized agent id', async () => {
    mockClack();
    const controlApiRequest = vi.fn(async () => ({
      agentId: 'agent:a1',
      sources: { skills: [], mcpServers: [], tools: [] },
      selections: [],
    }));
    vi.doMock('@core/cli/control-api.js', () => ({ controlApiRequest }));
    const { runAccess } = await import('@core/cli/group-access.js');
    expect(await runAccess('/tmp/gantry-access-test', ['show', 'a1'])).toBe(0);
    expect(controlApiRequest).toHaveBeenCalledWith(
      '/tmp/gantry-access-test',
      expect.objectContaining({
        method: 'GET',
        path: '/v1/agents/agent%3Aa1/access',
      }),
    );
  });

  it('apply PUTs only the writable {sources, selections} subset', async () => {
    mockClack();
    const controlApiRequest = vi.fn(async () => ({ ok: true }));
    vi.doMock('@core/cli/control-api.js', () => ({ controlApiRequest }));
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-access-')),
      'access.json',
    );
    // Includes read-only fields that `access show` emits — must be stripped.
    fs.writeFileSync(
      file,
      JSON.stringify({
        agentId: 'agent:a1',
        updatedAt: '2026-05-31T00:00:00.000Z',
        toolAccess: { configuredTools: [] },
        sources: { skills: [], mcpServers: [], tools: [] },
        selections: [{ id: 'browser.use', version: 'builtin' }],
      }),
    );
    const { runAccess } = await import('@core/cli/group-access.js');
    expect(
      await runAccess('/tmp/gantry-access-test', [
        'apply',
        'a1',
        '--file',
        file,
      ]),
    ).toBe(0);
    expect(controlApiRequest).toHaveBeenCalledWith(
      '/tmp/gantry-access-test',
      expect.objectContaining({
        method: 'PUT',
        path: '/v1/agents/agent%3Aa1/access',
        body: {
          sources: { skills: [], mcpServers: [], tools: [] },
          selections: [{ id: 'browser.use', version: 'builtin' }],
        },
      }),
    );
  });

  it('returns 1 when apply has no --file', async () => {
    mockClack();
    const controlApiRequest = vi.fn();
    vi.doMock('@core/cli/control-api.js', () => ({ controlApiRequest }));
    const { runAccess } = await import('@core/cli/group-access.js');
    expect(await runAccess('/tmp/gantry-access-test', ['apply', 'a1'])).toBe(1);
    expect(controlApiRequest).not.toHaveBeenCalled();
  });
});
