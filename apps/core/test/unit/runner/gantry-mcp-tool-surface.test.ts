import { describe, expect, it } from 'vitest';

import {
  applyGantryMcpToolSurface,
  DEFAULT_GANTRY_MCP_TOOL_NAMES,
  effectiveEnabledMcpToolNames,
  isRestrictableGantryMcpToolName,
  parseEnabledGantryMcpToolNames,
  parseGantryMcpToolSurfaceJson,
  selectedGantryMcpToolNames,
} from '@agent-runner-src/gantry-mcp-tool-surface.js';

describe('selectedGantryMcpToolNames with a tool-surface keep-list', () => {
  it('restricts the surface to exactly the kept tools', () => {
    expect(
      selectedGantryMcpToolNames([], {
        toolSurfaceKeepList: ['mcp_call_tool', 'mcp_list_tools'],
      }),
    ).toEqual(['mcp_call_tool', 'mcp_list_tools']);
  });

  it('cannot grant tools that the run would not otherwise expose', () => {
    // browser tools are capability-gated; a keep-list must not smuggle them in.
    expect(
      selectedGantryMcpToolNames([], {
        toolSurfaceKeepList: ['mcp_call_tool', 'browser_open'],
      }),
    ).toEqual(['mcp_call_tool']);
  });

  it('an empty keep-list means no gantry MCP tools', () => {
    expect(selectedGantryMcpToolNames([], { toolSurfaceKeepList: [] })).toEqual(
      [],
    );
  });

  it('no keep-list keeps the full default surface', () => {
    expect(selectedGantryMcpToolNames([])).toEqual(
      [...DEFAULT_GANTRY_MCP_TOOL_NAMES].sort(),
    );
  });
});

describe('parseGantryMcpToolSurfaceJson', () => {
  it('parses a keep-list and drops unknown names', () => {
    expect(
      parseGantryMcpToolSurfaceJson(
        JSON.stringify(['mcp_call_tool', 'not_a_tool', 'memory_search']),
      ),
    ).toEqual(['mcp_call_tool', 'memory_search']);
  });

  it('returns null (no restriction) when unset or malformed', () => {
    expect(parseGantryMcpToolSurfaceJson(undefined)).toBeNull();
    expect(parseGantryMcpToolSurfaceJson('')).toBeNull();
    expect(parseGantryMcpToolSurfaceJson('{"nope":1}')).toBeNull();
    expect(parseGantryMcpToolSurfaceJson('not json')).toBeNull();
  });

  it('keeps an explicit empty list as an empty restriction', () => {
    expect(parseGantryMcpToolSurfaceJson('[]')).toEqual([]);
  });
});

describe('applyGantryMcpToolSurface', () => {
  it('intersects the enabled set with the keep-list', () => {
    const enabled = parseEnabledGantryMcpToolNames(
      JSON.stringify(['mcp_call_tool']),
    );
    // parseEnabled seeds the full default set (stale-projection safety)…
    expect(enabled.has('send_message')).toBe(true);
    // …and the explicit settings-driven surface is what restricts it.
    const restricted = applyGantryMcpToolSurface(enabled, [
      'mcp_call_tool',
      'mcp_list_tools',
    ]);
    expect([...restricted].sort()).toEqual(['mcp_call_tool', 'mcp_list_tools']);
  });

  it('returns the enabled set unchanged when there is no restriction', () => {
    const enabled = new Set(['mcp_call_tool', 'send_message']);
    expect(applyGantryMcpToolSurface(enabled, null)).toBe(enabled);
  });
});

describe('effectiveEnabledMcpToolNames (gantry MCP server registration set)', () => {
  it('exposes the default surface plus all admin schemas when unrestricted', () => {
    const enabled = effectiveEnabledMcpToolNames(
      undefined,
      undefined,
      undefined,
    );
    expect(enabled.has('mcp_call_tool')).toBe(true);
    expect(enabled.has('send_message')).toBe(true);
    expect(enabled.has('service_restart')).toBe(true); // call-gated, schema visible
  });

  it('exposes only the keep-list when a tool surface is configured', () => {
    const enabled = effectiveEnabledMcpToolNames(
      undefined,
      undefined,
      JSON.stringify(['mcp_call_tool', 'mcp_list_tools']),
    );
    expect([...enabled].sort()).toEqual(['mcp_call_tool', 'mcp_list_tools']);
  });

  it('keeps capability-selected admin tools visible under a restriction', () => {
    const enabled = effectiveEnabledMcpToolNames(
      undefined,
      JSON.stringify(['service_restart']),
      JSON.stringify(['mcp_call_tool']),
    );
    expect([...enabled].sort()).toEqual(['mcp_call_tool', 'service_restart']);
    expect(enabled.has('register_agent')).toBe(false);
  });
});

describe('isRestrictableGantryMcpToolName', () => {
  it('accepts baseline, optional, reviewed, and gated tool names', () => {
    expect(isRestrictableGantryMcpToolName('mcp_call_tool')).toBe(true);
    expect(isRestrictableGantryMcpToolName('scheduler_list_jobs')).toBe(true);
    expect(isRestrictableGantryMcpToolName('memory_patch')).toBe(true);
    expect(isRestrictableGantryMcpToolName('browser_open')).toBe(true);
  });

  it('rejects admin tools and unknown names', () => {
    expect(isRestrictableGantryMcpToolName('service_restart')).toBe(false);
    expect(isRestrictableGantryMcpToolName('register_agent')).toBe(false);
    expect(isRestrictableGantryMcpToolName('made_up_tool')).toBe(false);
  });
});
