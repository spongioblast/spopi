// ABOUTME: Turns Pi MCP tool ids into a readable server and tool name.
// ABOUTME: Other tool names are left unchanged.

/**
 * `mcp__server__tool` becomes `server / tool`. A server name may contain `_`.
 * @param {unknown} name
 * @returns {string}
 */
export function displayToolName(name) {
  const text = String(name ?? "");
  const parts = text.split("__");
  if (parts.length < 3 || parts[0] !== "mcp" || parts.some((part) => part.length === 0)) {
    return text;
  }
  const tool = parts[parts.length - 1];
  const server = parts.slice(1, -1).join("__");
  return `${server} / ${tool}`;
}
