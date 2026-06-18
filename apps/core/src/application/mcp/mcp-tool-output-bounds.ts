export const MAX_MCP_TOOL_RESULT_CHARS = 100_000;

export function boundMcpToolResultForReturn(result: unknown): unknown {
  const serialized = serializeMcpToolResult(result, MAX_MCP_TOOL_RESULT_CHARS);
  if (!serialized.truncated) return result;
  return {
    type: 'mcp_tool_result_truncated',
    truncated: true,
    maxChars: MAX_MCP_TOOL_RESULT_CHARS,
    preview: serialized.text,
  };
}

export function serializeMcpToolResult(
  result: unknown,
  maxChars = MAX_MCP_TOOL_RESULT_CHARS,
): { text: string; truncated: boolean } {
  const text =
    typeof result === 'string'
      ? result
      : stringifyMcpToolResult(result ?? null);
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n[truncated MCP tool result]`,
    truncated: true,
  };
}

function stringifyMcpToolResult(result: unknown): string {
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return '"[Unserializable MCP tool result]"';
  }
}
