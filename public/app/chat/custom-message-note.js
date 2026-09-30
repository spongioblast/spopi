// ABOUTME: Text of a Pi custom_message entry that an extension asked to show (display: true).
// ABOUTME: Returns plain text for a system note; it does not render and ignores hidden entries.

/**
 * Boundary handlers (turn_end, agent_before_settle) append these entries, for
 * example the verify gate's repair request. They arrive as `entry_appended`,
 * not as message events, so the live transcript would otherwise skip them.
 * @param {unknown} entry
 * @returns {string | null}
 */
export function customMessageNote(entry) {
  if (!entry || typeof entry !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (entry);
  if (record.type !== "custom_message" || record.display !== true) return null;
  const content = record.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((block) =>
      block && typeof block === "object" && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("")
    .trim();
  return text || null;
}
