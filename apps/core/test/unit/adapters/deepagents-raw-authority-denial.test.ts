import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createBuiltinToolExclusionMiddleware,
  EXCLUDED_BUILTIN_DEEPAGENT_TOOL_NAMES,
} from '@core/adapters/llm/deepagents-langchain/runner/builtin-tool-exclusion.js';

const DEEPAGENTS_DIR = path.resolve(
  __dirname,
  '../../../src/adapters/llm/deepagents-langchain',
);

function readDirFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

describe('DeepAgents raw authority denial', () => {
  it('excludes the task subagent tool and write_todos from the model-visible surface', async () => {
    const middleware = createBuiltinToolExclusionMiddleware() as unknown as {
      name: string;
      wrapModelCall: (
        request: { tools: Array<{ name: string }> },
        handler: (r: { tools: Array<{ name: string }> }) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    expect(middleware.name).toBe('GantryBuiltinToolExclusionMiddleware');

    let seen: Array<{ name: string }> = [];
    await middleware.wrapModelCall(
      {
        tools: [
          { name: 'task' },
          { name: 'write_todos' },
          { name: 'send_message' },
          { name: 'browser_open' },
          { name: 'mcp_call_tool' },
        ],
      },
      async (request) => {
        seen = request.tools;
        return { result: [] };
      },
    );
    const seenNames = seen.map((tool) => tool.name).sort();
    expect(seenNames).toEqual([
      'browser_open',
      'mcp_call_tool',
      'send_message',
    ]);
    expect(seenNames).not.toContain('task');
    expect(seenNames).not.toContain('write_todos');
  });

  it('lists task and write_todos as the excluded builtin tool names', () => {
    expect([...EXCLUDED_BUILTIN_DEEPAGENT_TOOL_NAMES].sort()).toEqual([
      'task',
      'write_todos',
    ]);
  });

  it('never references LocalShellBackend, FilesystemBackend, or an execute tool in the runner', () => {
    const runnerFile = path.join(
      DEEPAGENTS_DIR,
      'runner',
      'deep-agent-runner.ts',
    );
    const text = fs.readFileSync(runnerFile, 'utf-8');
    // The import statement and createDeepAgent backend must be StateBackend only.
    expect(text).toContain('new StateBackend()');
    expect(text).not.toMatch(/new\s+LocalShellBackend/);
    expect(text).not.toMatch(/new\s+FilesystemBackend/);
    expect(text).not.toMatch(/import\s*\{[^}]*LocalShellBackend[^}]*\}/);
    expect(text).not.toMatch(/import\s*\{[^}]*FilesystemBackend[^}]*\}/);
  });

  it('keeps a deny-all filesystem permission block on the agent', () => {
    const runnerFile = path.join(
      DEEPAGENTS_DIR,
      'runner',
      'deep-agent-runner.ts',
    );
    const text = fs.readFileSync(runnerFile, 'utf-8');
    expect(text).toMatch(/operations:\s*\['read',\s*'write'\]/);
    expect(text).toMatch(/paths:\s*\['\/\*\*'\]/);
    expect(text).toMatch(/mode:\s*'deny'/);
    expect(text).toContain('permissions: DENY_ALL_FILESYSTEM');
  });

  it('reads no .mcp.json anywhere in the DeepAgents adapter directory', () => {
    // rg-style guard: the lane fully controls `tools`; it must never read a raw
    // DeepAgents/MCP `.mcp.json` authority file. (See the adapter AGENTS.md note.)
    for (const file of readDirFilesRecursive(DEEPAGENTS_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const text = fs.readFileSync(file, 'utf-8');
      expect(text, `${file} must not reference .mcp.json`).not.toContain(
        '.mcp.json',
      );
    }
  });
});
