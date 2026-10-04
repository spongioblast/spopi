// ABOUTME: Session-load diagnostics and the short title taken from a message.
// ABOUTME: Contract: never changes hydration, only logs it.

/**
 * @param {Array<{ role?: string }> | null | undefined} messages
 * @returns {Record<string, number>}
 */
export function summarizeMessageRoles(messages) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message?.role || "unknown";
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

/**
 * Counts only: message text never reaches the console.
 * @param {Element | null | undefined} messagesElement
 * @param {string} label
 * @param {Record<string, unknown>} [extra]
 */
export function logMessagesDom(messagesElement, label, extra = {}) {
  console.info(`[spopi] session load: ${label}`, {
    ...extra,
    children: messagesElement?.children.length ?? 0,
  });
}

/**
 * @param {string | { name?: string, id?: string } | null | undefined} model
 * @returns {string}
 */
export function formatModelName(model) {
  const raw = typeof model === "string" ? model : model?.name || model?.id || "";
  return raw.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/**
 * @param {{ name?: string, id?: string, provider?: string }} model
 * @returns {string}
 */
export function getModelSearchText(model) {
  return [model.name, model.id, model.provider].filter(Boolean).join(" ").toLowerCase();
}

/**
 * @param {string | Array<{ type?: string, text?: string }> | null | undefined} content
 * @returns {string | null}
 */
export function textFromMessageContent(content) {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  const text = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  return text ? text.slice(0, 120) : null;
}

/**
 * @param {string | null | undefined} level
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function formatThinkingLevelLabel(level, t) {
  const normalizedLevel = level || "off";
  const key = `settings.thinkingLevels.${normalizedLevel}`;
  const label = t(key);
  return label === key ? normalizedLevel : label;
}
