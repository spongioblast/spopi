// ABOUTME: Paints the header metrics and hides toggles that do not apply.
// ABOUTME: The numbers come from the session status.
// ABOUTME: Slim the SPOPI header under .spopi-shell and add dock/chat/TUI controls.

import { createIcon } from "../ui/icons.js";

const HIDDEN_HEADER_IDS = [
  "file-sidebar-toggle",
  "diff-sidebar-toggle",
  "info-sidebar-toggle",
  "package-update-indicator",
];

/**
 * @param {{
 *   getElementById?: (id: string) => Element | null,
 *   querySelector?: (selectors: string) => Element | null,
 *   querySelectorAll?: (selectors: string) => Iterable<Element>,
 * }} [root]
 */
export function hideHeaderToggles(root = document) {
  for (const id of HIDDEN_HEADER_IDS) {
    const node = root.getElementById?.(id) || root.querySelector?.(`#${id}`);
    if (!node) continue;
    if (id === "package-update-indicator" && "dataset" in node) {
      const dataset = /** @type {DOMStringMap} */ (node.dataset);
      if (dataset.count && dataset.count !== "0") continue;
    }
    if ("hidden" in node) /** @type {{ hidden: boolean }} */ (node).hidden = true;
    node.classList.add("hidden");
  }
  for (const node of root.querySelectorAll?.(".terminal-toggle") || []) {
    if ("hidden" in node) /** @type {{ hidden: boolean }} */ (node).hidden = true;
    node.classList.add("hidden");
  }
}

/**
 * @param {{ tokPerSec?: number, ttftMs?: number }} [status]
 */
export function paintHeaderMetrics(status = {}) {
  const pill = document.getElementById("header-metrics");
  if (!pill) return;
  const parts = [];
  const tokPerSec = status.tokPerSec;
  const ttftMs = status.ttftMs;
  if (typeof tokPerSec === "number" && Number.isFinite(tokPerSec)) {
    parts.push(`${Math.round(tokPerSec)} t/s`);
  }
  if (typeof ttftMs === "number" && Number.isFinite(ttftMs)) {
    parts.push(`${Math.round(ttftMs)} ms`);
  }
  pill.textContent = parts.join(" · ");
}

/**
 * @param {object} [options]
 * @param {(key: string, fallback?: string) => string} [options.t]
 * @param {(force?: boolean) => void} [options.onToggleDock]
 * @param {() => void} [options.onToggleChat]
 * @param {() => void} [options.onOpenTerminal]
 * @param {() => void} [options.onOpenCockpit]
 * @returns {{ terminal: Element } | null}
 */
export function mountHeaderChrome({
  t = (key) => key,
  onToggleDock,
  onToggleChat,
  onOpenTerminal,
  onOpenCockpit,
} = {}) {
  const header = document.querySelector(".header-right") || document.querySelector(".header");
  if (!header) return null;
  hideHeaderToggles(document);

  ensureButton(header, "header-metrics", "pill", t("header.metrics") || "Live metrics", () => {
    if (onOpenCockpit) onOpenCockpit();
    else onToggleDock?.(false);
  });

  const terminal = ensureIcon(
    header,
    "open-in-terminal-btn",
    "terminal",
    t("header.openInPiTui") || "Open this session in the Pi TUI (pi -r)",
  );
  terminal.addEventListener("click", () => onOpenTerminal?.());

  ensureIcon(
    header,
    "toggle-dock",
    "dock",
    t("header.toggleDock") || "Toggle dock (Ctrl+J)",
  ).addEventListener("click", () => onToggleDock?.());
  ensureIcon(
    header,
    "toggle-chat",
    "chat",
    t("header.toggleChat") || "Toggle chat (Ctrl+Shift+L)",
  ).addEventListener("click", () => onToggleChat?.());
  return { terminal };
}

/**
 * @param {ParentNode} parent
 * @param {string} id
 * @param {string} className
 * @param {string} title
 * @param {(() => void) | null | undefined} [onClick]
 */
function ensureButton(parent, id, className, title, onClick) {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement("button");
    node.id = id;
    node.className = className;
    if (node instanceof HTMLButtonElement) node.type = "button";
    parent.appendChild(node);
  }
  node.title = title;
  node.setAttribute("aria-label", title);
  node.setAttribute("data-i18n-aria-label", "header.metrics");
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

/**
 * @param {ParentNode} parent
 * @param {string} id
 * @param {string} icon
 * @param {string} title
 */
function ensureIcon(parent, id, icon, title) {
  let node = document.getElementById(id);
  if (!node) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn";
    const mark = createIcon(icon);
    if (mark) button.appendChild(mark);
    parent.appendChild(button);
    node = button;
  }
  node.title = title;
  node.setAttribute("aria-label", title);
  return node;
}
