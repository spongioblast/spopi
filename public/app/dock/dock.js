// ABOUTME: Editor-column dock: Terminal, Problems, Cockpit + status strip.
// ABOUTME: Search stays on the rail. Default tab is Terminal when a PTY exists, else Cockpit.

import { cacheSharePct } from "../metrics/metrics-model.js";
import { filePreviewRefs } from "../shell/chrome/file-preview.js";
import { registerStatusFooter } from "../shell/status-footer.js";

const DOCK_TABS = ["terminal", "problems", "cockpit"];

/**
 * @typedef {Record<string, HTMLElement>} DockPanels
 *
 * @typedef {HTMLElement & {
 *   panels?: DockPanels,
 *   setTab?: (id: string) => string,
 * }} DockHostElement
 *
 * @typedef {{
 *   t?: (key: string) => string,
 *   initialTab?: string,
 *   onTabChange?: (id: string) => void,
 *   terminal?: HTMLElement | null,
 * }} CreateDockHostOptions
 *
 * @typedef {{
 *   decodeTps?: number,
 *   engine?: { meanTtftMs?: number },
 *   cacheSharePct?: number,
 *   inputTokens?: number,
 *   cacheReadTokens?: number,
 * }} DockStatusPrompt
 *
 * @typedef {{
 *   prompt?: DockStatusPrompt,
 *   rates?: {
 *     meanTtftMs?: number,
 *     prefixHitPct?: number,
 *     cacheHitPct?: number,
 *   },
 *   server?: { kvCachePct?: number },
 *   turn?: { liveTps?: number },
 *   avgDecodeTps?: number,
 * }} DockStatusSnapshot
 *
 * @typedef {{
 *   tokPerSec?: number,
 *   ttftMs?: number,
 *   cachePct?: number,
 *   kvPct?: number,
 * }} DockStatusMetrics
 */

/**
 * @param {HTMLElement | Element | null | undefined} paneCenter
 * @param {CreateDockHostOptions} [options]
 * @returns {DockHostElement}
 */
export function createDockHost(
  paneCenter,
  { t = (key) => key, initialTab, onTabChange, terminal } = {},
) {
  /** @type {DockHostElement | null} */
  let dock = /** @type {DockHostElement | null} */ (document.getElementById("spopi-dock"));
  if (dock?.panels) return dock;

  dock = /** @type {DockHostElement} */ (document.createElement("section"));
  const host = dock;
  host.id = "spopi-dock";
  host.className = "spopi-dock";
  host.dataset.terminalTheme = "system";

  const tabs = document.createElement("div");
  tabs.className = "ui-tabs spopi-dock-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("dock.tabs"));
  /** @type {DockPanels} */
  const panels = {};
  for (const id of DOCK_TABS) {
    const node = document.createElement("div");
    node.id = `spopi-dock-${id}`;
    node.className = "spopi-workbench-panel";
    node.dataset.label = t(`dock.${id}`) || id;
    node.setAttribute("role", "tabpanel");
    node.setAttribute("aria-labelledby", `spopi-dock-tab-${id}`);
    node.hidden = true;
    panels[id] = node;
  }

  // Per-tab actions live in the dock strip (Cursor style), not in a second
  // tab bar inside the panel. Today: the terminal's `+`.
  const actions = document.createElement("div");
  actions.className = "spopi-dock-actions";
  actions.id = "spopi-dock-actions";

  if (terminal) {
    terminal.classList.remove("hidden");
    panels.terminal.replaceChildren(terminal);
    const newTab = terminal.querySelector("[data-terminal-new-tab]");
    const newTabGroup = newTab?.closest(".terminal-new-tab-group") || newTab;
    if (newTabGroup && "dataset" in newTabGroup) {
      const group = /** @type {HTMLElement} */ (newTabGroup);
      group.dataset.dockAction = "terminal";
      for (const button of group.querySelectorAll?.("button") || []) {
        if (!("dataset" in button)) continue;
        /** @type {HTMLElement} */ (button).dataset.dockAction = "terminal";
      }
      actions.appendChild(group);
    }
  }

  const statuses = document.createElement("div");
  statuses.className = "spopi-dock-statuses";
  registerStatusFooter(statuses);

  const status = document.createElement("button");
  status.type = "button";
  status.className = "spopi-dock-status";
  status.id = "dock-status";
  status.title = t("dock.status") || "Session and server metrics";

  /**
   * @param {string} id
   * @returns {string}
   */
  const setTab = (id) => {
    const next = DOCK_TABS.includes(id) ? id : "cockpit";
    for (const [key, node] of Object.entries(panels)) node.hidden = key !== next;
    for (const button of tabs.querySelectorAll("[data-dock]")) {
      if (!("dataset" in button)) continue;
      const el = /** @type {HTMLElement} */ (button);
      el.classList.toggle("active", el.dataset.dock === next);
      el.setAttribute("aria-selected", el.dataset.dock === next ? "true" : "false");
    }
    for (const action of actions.querySelectorAll("[data-dock-action]")) {
      if (!("dataset" in action) || !("hidden" in action)) continue;
      const el = /** @type {HTMLElement} */ (action);
      el.hidden = el.dataset.dockAction !== next;
    }
    host.dataset.activeTab = next;
    onTabChange?.(next);
    return next;
  };

  for (const id of DOCK_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-tab spopi-dock-tab";
    button.dataset.dock = id;
    button.id = `spopi-dock-tab-${id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.textContent = t(`dock.${id}`) || id;
    button.addEventListener("click", () => setTab(id));
    tabs.appendChild(button);
  }
  status.addEventListener("click", () => setTab("cockpit"));
  const tools = document.createElement("div");
  tools.className = "spopi-dock-tools";
  tools.append(actions, statuses, status);
  const bar = document.createElement("div");
  bar.className = "spopi-dock-bar";
  bar.append(tabs, tools);

  host.append(bar, ...Object.values(panels));
  (paneCenter || filePreviewRefs().panel?.parentElement || document.body).appendChild(host);

  const defaultTab = initialTab || (terminal ? "terminal" : "cockpit");
  setTab(defaultTab);
  host.panels = panels;
  host.setTab = setTab;
  return host;
}

/**
 * @param {string | null | undefined} mode
 */
export function setDockTerminalTheme(mode) {
  const dock = document.getElementById("spopi-dock");
  if (!dock) return;
  dock.setAttribute("data-terminal-theme", mode === "light" || mode === "dark" ? mode : "system");
}

/**
 * @param {DockStatusSnapshot} [snapshot]
 * @returns {DockStatusMetrics}
 */
export function dockStatusFromSnapshot(snapshot = {}) {
  const prompt = snapshot.prompt || {};
  const engine = prompt.engine || {};
  const rates = snapshot.rates || {};
  const server = snapshot.server || {};
  const tokPerSec = prompt.decodeTps || snapshot.turn?.liveTps || snapshot.avgDecodeTps;
  const ttftMs = engine.meanTtftMs || rates.meanTtftMs;
  const cachePct =
    rates.prefixHitPct ||
    rates.cacheHitPct ||
    prompt.cacheSharePct ||
    cacheSharePct(prompt.inputTokens, prompt.cacheReadTokens);
  const kvPct = server.kvCachePct;
  /** @param {unknown} value */
  const finite = (value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  return {
    tokPerSec: finite(tokPerSec),
    ttftMs: finite(ttftMs),
    cachePct: finite(cachePct),
    kvPct: finite(kvPct),
  };
}

/**
 * The status button this module creates.
 * @param {ParentNode} [root]
 * @returns {Element | null}
 */
export function dockStatusElement(root = document) {
  return root.querySelector("#dock-status");
}

/**
 * @param {HTMLElement | Element | null | undefined} root
 * @param {DockStatusMetrics} [metrics]
 */
export function renderDockStatus(root, { tokPerSec, ttftMs, kvPct } = {}) {
  if (!root || !("replaceChildren" in root)) return;
  const host = /** @type {HTMLElement} */ (root);
  const extension = host.querySelector(".extension-status");
  /** @param {string} label */
  const chip = (label) => {
    const span = document.createElement("span");
    span.textContent = label;
    return span;
  };
  host.replaceChildren();
  if (extension) host.append(extension);
  if (typeof tokPerSec === "number" && Number.isFinite(tokPerSec)) {
    host.appendChild(chip(`${Math.round(tokPerSec)} t/s`));
  }
  if (typeof ttftMs === "number" && Number.isFinite(ttftMs)) {
    host.appendChild(chip(`${Math.round(ttftMs)} ms`));
  }
  if (typeof kvPct === "number" && Number.isFinite(kvPct)) {
    host.appendChild(chip(`KV ${Math.round(kvPct)}%`));
  }
}
