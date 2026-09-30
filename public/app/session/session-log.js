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
 * @param {Element | null | undefined} element
 */
function summarizeElementBox(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    tag: element.tagName?.toLowerCase() ?? null,
    id: element.id || null,
    className: String(element.className || ""),
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    position: style.position,
    zIndex: style.zIndex,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    top: Math.round(rect.top),
    left: Math.round(rect.left),
  };
}

/**
 * @param {Element | null | undefined} messagesElement
 */
function summarizeMessagesDom(messagesElement) {
  if (!messagesElement) return null;
  const style = getComputedStyle(messagesElement);
  const rect = messagesElement.getBoundingClientRect();
  const firstChildren = Array.from(messagesElement.children)
    .slice(0, 5)
    .map((child) => ({
      className: String(child.className || ""),
      textLength: child.textContent?.trim().length ?? 0,
      textPreview: (child.textContent || "").trim().slice(0, 80),
      box: summarizeElementBox(child),
    }));
  const centerX = Math.round(rect.left + rect.width / 2);
  const centerY = Math.round(rect.top + Math.min(rect.height / 2, 160));
  const elementAtCenter = document.elementFromPoint(centerX, centerY);
  return {
    bodyClass: document.body.className || null,
    url: window.location.href,
    messages: summarizeElementBox(messagesElement),
    main: summarizeElementBox(document.querySelector(".main")),
    workspaceContent: summarizeElementBox(document.querySelector(".workspace-content")),
    inputArea: summarizeElementBox(document.querySelector(".input-area")),
    childCount: messagesElement.children.length,
    firstChildClass: messagesElement.firstElementChild?.className ?? null,
    userCount: messagesElement.querySelectorAll(".message.user, .user").length,
    assistantCount: messagesElement.querySelectorAll(".message.assistant, .assistant").length,
    toolCardCount: messagesElement.querySelectorAll(".tool-card").length,
    processGroupCount: messagesElement.querySelectorAll(".process-details").length,
    hasWelcome: Boolean(messagesElement.querySelector(".welcome")),
    scrollTop: Math.round(messagesElement.scrollTop),
    scrollHeight: messagesElement.scrollHeight,
    clientHeight: messagesElement.clientHeight,
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    overflowY: style.overflowY,
    elementAtCenter: summarizeElementBox(elementAtCenter),
    firstChildren,
  };
}

/**
 * @param {Element | null | undefined} messagesElement
 * @param {string} label
 * @param {Record<string, unknown>} [extra]
 */
export function logMessagesDom(messagesElement, label, extra = {}) {
  console.info(`[SESSION-LOAD] ${label}`, extra);
  console.info(
    `[SESSION-LOAD] ${label} dom-json`,
    JSON.stringify(summarizeMessagesDom(messagesElement)),
  );
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
