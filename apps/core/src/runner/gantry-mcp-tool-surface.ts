import {
  ADMIN_MCP_TOOL_NAMES,
  isAdminMcpToolName,
} from '../shared/admin-mcp-tools.js';
import {
  selectedMemoryIpcActionsFromToolRules,
  type GantryMemoryIpcAction,
  type MemoryIpcActionSelectionOptions,
} from '../shared/memory-ipc-actions.js';
import { isCanonicalBrowserCapabilityRule } from '../shared/agent-tool-references.js';
import {
  DEFAULT_GANTRY_MCP_TOOL_NAMES,
  GATED_GANTRY_MCP_TOOL_NAMES,
  REVIEWER_MEMORY_REVIEW_GANTRY_MCP_TOOL_NAMES,
  ALL_GANTRY_MCP_TOOL_NAME_SET,
  RESTRICTABLE_GANTRY_MCP_TOOL_NAME_SET,
  gantryMcpFullToolName,
  gantryMcpToolNameFromFullName,
} from '../shared/gantry-mcp-tool-catalog.js';

// The gantry MCP tool-name vocabulary lives in `shared/gantry-mcp-tool-catalog`
// (importable by config, runner, and adapters alike); this module owns the
// selection/registration LOGIC and re-exports the vocabulary so existing
// importers keep their stable import path.
export {
  BASELINE_GANTRY_MCP_TOOL_NAMES,
  OPTIONAL_GANTRY_MCP_TOOL_NAMES,
  REVIEWED_GANTRY_MCP_TOOL_NAMES,
  GATED_GANTRY_MCP_TOOL_NAMES,
  DEFAULT_GANTRY_MCP_TOOL_NAMES,
  ALL_GANTRY_MCP_TOOL_NAMES,
  RESTRICTABLE_GANTRY_MCP_TOOL_NAMES,
  isRestrictableGantryMcpToolName,
  gantryMcpFullToolName,
  gantryMcpToolNameFromFullName,
} from '../shared/gantry-mcp-tool-catalog.js';

export interface GantryMcpToolSelectionOptions extends MemoryIpcActionSelectionOptions {
  /**
   * Settings-driven per-agent keep-list (`agents.<folder>.tool_surface.gantry_mcp`).
   * When present, the computed surface is FILTERED to these names — a pure
   * restriction that can never grant a tool the run would not otherwise have.
   */
  toolSurfaceKeepList?: readonly string[] | null;
}

export function selectedGantryMcpToolNames(
  configuredTools: readonly string[],
  options: GantryMcpToolSelectionOptions = {},
): string[] {
  const names = new Set<string>(DEFAULT_GANTRY_MCP_TOOL_NAMES);
  if (isBrowserSelected(configuredTools)) {
    for (const toolName of GATED_GANTRY_MCP_TOOL_NAMES) names.add(toolName);
  }
  if (options.memoryReviewerIsControlApprover) {
    for (const toolName of REVIEWER_MEMORY_REVIEW_GANTRY_MCP_TOOL_NAMES) {
      names.add(toolName);
    }
  }
  for (const configuredTool of configuredTools) {
    const name = gantryMcpToolNameFromFullName(configuredTool);
    if (
      name &&
      !(GATED_GANTRY_MCP_TOOL_NAMES as readonly string[]).includes(name)
    ) {
      names.add(name);
    }
  }
  const selected = [...names].sort();
  const keepList = options.toolSurfaceKeepList;
  if (keepList === undefined || keepList === null) return selected;
  const keep = new Set(keepList);
  return selected.filter((name) => keep.has(name));
}

/**
 * Applies a per-agent tool-surface keep-list to an already-resolved enabled
 * set (runner side). `null` means "no restriction configured" and returns the
 * input set untouched — preserving the stale-projection safety net that seeds
 * the default surface.
 */
export function applyGantryMcpToolSurface(
  enabled: Set<string>,
  keepList: readonly string[] | null,
): Set<string> {
  if (keepList === null) return enabled;
  const keep = new Set(keepList);
  return new Set([...enabled].filter((name) => keep.has(name)));
}

/**
 * Parses the `GANTRY_MCP_TOOL_SURFACE_JSON` env projection. Returns `null`
 * (no restriction) when unset or malformed — the value is machine-generated
 * from validated settings, so a malformed value is a bug upstream, never a
 * reason to fail the run.
 */
export function parseGantryMcpToolSurfaceJson(
  raw: string | undefined,
): string[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((name) => RESTRICTABLE_GANTRY_MCP_TOOL_NAME_SET.has(name));
    // eslint-disable-next-line no-catch-all/no-catch-all -- machine-generated env projection; malformed means an upstream bug, never a reason to fail the run.
  } catch {
    return null;
  }
}

function isBrowserSelected(configuredTools: readonly string[]): boolean {
  return configuredTools.some(isCanonicalBrowserCapabilityRule);
}

export function selectedGantryMcpFullToolNames(
  configuredTools: readonly string[],
  options: GantryMcpToolSelectionOptions = {},
): string[] {
  return selectedGantryMcpToolNames(configuredTools, options).map(
    gantryMcpFullToolName,
  );
}

export function parseEnabledGantryMcpToolNames(
  raw: string | undefined,
): Set<string> {
  if (!raw?.trim()) {
    return new Set(DEFAULT_GANTRY_MCP_TOOL_NAMES);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set(DEFAULT_GANTRY_MCP_TOOL_NAMES);
    }
    const enabled = new Set<string>(DEFAULT_GANTRY_MCP_TOOL_NAMES);
    for (const item of parsed) {
      const toolName = typeof item === 'string' ? item.trim() : '';
      if (ALL_GANTRY_MCP_TOOL_NAME_SET.has(toolName)) enabled.add(toolName);
    }
    return enabled;
  } catch {
    return new Set(DEFAULT_GANTRY_MCP_TOOL_NAMES);
  }
}

export function selectedMemoryIpcActions(
  configuredTools: readonly string[],
  options: MemoryIpcActionSelectionOptions = {},
): GantryMemoryIpcAction[] {
  return selectedMemoryIpcActionsFromToolRules(configuredTools, options);
}

/**
 * The tool-name set the gantry MCP server actually registers for a run,
 * resolved from the three env projections core hands the server process.
 * Pure so the registration policy is unit-testable without a live IPC env.
 */
export function effectiveEnabledMcpToolNames(
  rawToolNames: string | undefined,
  rawAdminToolNames: string | undefined,
  rawToolSurface: string | undefined,
): Set<string> {
  const toolSurface = parseGantryMcpToolSurfaceJson(rawToolSurface);
  const enabledTools = new Set(
    [
      ...applyGantryMcpToolSurface(
        parseEnabledGantryMcpToolNames(rawToolNames),
        toolSurface,
      ),
    ].filter((toolName) => !isAdminMcpToolName(toolName)),
  );

  if (toolSurface === null) {
    // No restriction: every admin tool stays visible (schemas only — each
    // call is still capability-gated server-side).
    for (const toolName of ADMIN_MCP_TOOL_NAMES) enabledTools.add(toolName);
  } else {
    // Restricted surface: expose only the admin tools this agent actually
    // selected via capabilities; the keep-list itself may not name them.
    for (const toolName of parseSelectedAdminToolNames(rawAdminToolNames)) {
      enabledTools.add(toolName);
    }
  }

  return enabledTools;
}

function parseSelectedAdminToolNames(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string =>
        typeof item === 'string' && isAdminMcpToolName(item),
    );
    // eslint-disable-next-line no-catch-all/no-catch-all -- machine-generated env projection; fail closed to no admin tools.
  } catch {
    return [];
  }
}
