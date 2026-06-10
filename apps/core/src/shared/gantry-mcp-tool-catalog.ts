// Canonical gantry MCP tool-name vocabulary, in the `shared` layer so any
// layer that needs to *name* or *validate* a gantry MCP tool (settings config,
// runner selection logic, provider adapters) depends on one source of truth —
// mirroring how `shared/model-catalog` and `shared/admin-mcp-tools` are shared
// vocabulary. This module holds names and pure name helpers only; the
// selection/registration LOGIC lives in `runner/gantry-mcp-tool-surface`.
import { ADMIN_MCP_TOOL_NAMES } from './admin-mcp-tools.js';

export const BASELINE_GANTRY_MCP_TOOL_NAMES = [
  'send_message',
  'ask_user_question',
  'memory_search',
  'memory_save',
  'continuity_summary',
  'procedure_save',
  'request_skill_install',
  'request_skill_proposal',
  'request_skill_dependency_install',
  'request_mcp_server',
  'request_permission',
  'capability_status',
  'capability_search',
  'propose_capability',
  'manage_capability',
  'file',
  'mcp_list_tools',
  'mcp_call_tool',
] as const;

export const OPTIONAL_GANTRY_MCP_TOOL_NAMES = [
  'scheduler_list_models',
  'scheduler_upsert_job',
  'scheduler_get_job',
  'scheduler_list_jobs',
  'scheduler_list_notification_targets',
  'scheduler_update_job',
  'scheduler_delete_job',
  'scheduler_pause_job',
  'scheduler_resume_job',
  'scheduler_run_now',
  'scheduler_list_runs',
  'scheduler_list_events',
  'scheduler_wait_for_events',
  'scheduler_get_dead_letter',
] as const;

export const REVIEWED_GANTRY_MCP_TOOL_NAMES = [
  'memory_patch',
  'memory_demote',
  'procedure_patch',
  'memory_dream',
  'memory_consolidate',
  'memory_review_pending',
  'memory_review_decision',
] as const;

export const REVIEWER_MEMORY_REVIEW_GANTRY_MCP_TOOL_NAMES = [
  'memory_review_pending',
  'memory_review_decision',
] as const;

export const GATED_GANTRY_MCP_TOOL_NAMES = [
  'browser_status',
  'browser_open',
  'browser_inspect',
  'browser_act',
  'browser_close',
] as const;

export const DEFAULT_GANTRY_MCP_TOOL_NAMES = [
  ...BASELINE_GANTRY_MCP_TOOL_NAMES,
  ...OPTIONAL_GANTRY_MCP_TOOL_NAMES,
] as const;

export const ALL_GANTRY_MCP_TOOL_NAMES = [
  ...DEFAULT_GANTRY_MCP_TOOL_NAMES,
  ...GATED_GANTRY_MCP_TOOL_NAMES,
  ...REVIEWED_GANTRY_MCP_TOOL_NAMES,
  ...ADMIN_MCP_TOOL_NAMES,
] as const;

export const ALL_GANTRY_MCP_TOOL_NAME_SET = new Set<string>(
  ALL_GANTRY_MCP_TOOL_NAMES,
);

/**
 * Non-admin gantry MCP tool names a per-agent `tool_surface` keep-list may
 * reference. Admin tools are deliberately excluded: they are granted through
 * selected capabilities, never through a surface restriction.
 */
export const RESTRICTABLE_GANTRY_MCP_TOOL_NAMES = [
  ...DEFAULT_GANTRY_MCP_TOOL_NAMES,
  ...REVIEWED_GANTRY_MCP_TOOL_NAMES,
  ...GATED_GANTRY_MCP_TOOL_NAMES,
] as const;

export const RESTRICTABLE_GANTRY_MCP_TOOL_NAME_SET = new Set<string>(
  RESTRICTABLE_GANTRY_MCP_TOOL_NAMES,
);

export function isRestrictableGantryMcpToolName(name: string): boolean {
  return RESTRICTABLE_GANTRY_MCP_TOOL_NAME_SET.has(name);
}

export function gantryMcpFullToolName(toolName: string): string {
  return `mcp__gantry__${toolName}`;
}

export function gantryMcpToolNameFromFullName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('mcp__gantry__')) return null;
  const toolName = trimmed.slice('mcp__gantry__'.length);
  return ALL_GANTRY_MCP_TOOL_NAME_SET.has(toolName) ? toolName : null;
}
