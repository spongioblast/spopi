// ABOUTME: Turns a Pi tool call's arguments into the one-line label the Cockpit shows for it.
// ABOUTME: Pure string helpers; the tool rows themselves are kept by the turn tracker.

/**
 * @param {unknown[]} values
 * @returns {string}
 */
function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Full one-line description of a tool call, untruncated (used for tooltips).
 *
 * @param {unknown} toolName
 * @param {unknown} args
 * @returns {string}
 */
export function describeToolArgs(toolName, args) {
  const source =
    args && typeof args === "object" ? /** @type {Record<string, unknown>} */ (args) : {};
  return (
    firstString([
      source.command,
      source.cmd,
      source.path,
      source.file,
      source.filePath,
      source.pattern,
      source.query,
      source.prompt,
      source.url,
      source.subject,
      source.title,
      source.message,
    ]) || (toolName === "todo" ? "todo" : "")
  );
}

/**
 * Display label for a tool call. Long enough that the card's own CSS ellipsis
 * (not a hard slice) is what the user perceives as truncation.
 *
 * @param {unknown} toolName
 * @param {unknown} args
 * @param {number} [limit]
 * @returns {string}
 */
export function summarizeToolArgs(toolName, args, limit = 160) {
  const text = describeToolArgs(toolName, args);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
