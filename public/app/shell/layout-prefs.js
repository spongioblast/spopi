// ABOUTME: Clamps and applies ui.layout: sidebar, chat, and dock sizes, hidden flags, and Focus.
// ABOUTME: Sizes become CSS variables on the layout root; flags become body classes.

/**
 * @typedef {{
 *   sidebarWidth: number,
 *   chatWidthPct: number,
 *   dockHeight: number,
 *   sidebarHidden: boolean,
 *   chatHidden: boolean,
 *   dockHidden: boolean,
 *   focus: boolean,
 * }} LayoutPrefs
 */

/** @type {LayoutPrefs} */
export const DEFAULT_LAYOUT = {
  sidebarWidth: 240,
  chatWidthPct: 34,
  dockHeight: 300,
  sidebarHidden: false,
  chatHidden: false,
  dockHidden: false,
  focus: false,
};

/** @param {unknown} width */
export function clampSidebarWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n)) return DEFAULT_LAYOUT.sidebarWidth;
  return Math.min(480, Math.max(160, Math.round(n)));
}

/** @param {unknown} pct */
export function clampChatWidthPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return DEFAULT_LAYOUT.chatWidthPct;
  return Math.min(60, Math.max(22, Math.round(n)));
}

/**
 * @param {unknown} height
 * @param {unknown} [centerHeight]
 */
export function clampDockHeight(height, centerHeight) {
  const n = Number(height);
  if (!Number.isFinite(n)) return DEFAULT_LAYOUT.dockHeight;
  const max =
    typeof centerHeight === "number" && Number.isFinite(centerHeight)
      ? Math.max(120, Math.round(centerHeight * 0.7))
      : 600;
  return Math.min(max, Math.max(120, Math.round(n)));
}

/**
 * @param {Partial<LayoutPrefs>} [raw]
 * @returns {LayoutPrefs}
 */
export function normalizeLayout(raw = {}) {
  const rawDock = raw.dockHeight;
  const dockHeight =
    rawDock === 168 || rawDock == null ? DEFAULT_LAYOUT.dockHeight : clampDockHeight(rawDock);
  return {
    sidebarWidth: clampSidebarWidth(raw.sidebarWidth ?? DEFAULT_LAYOUT.sidebarWidth),
    chatWidthPct: clampChatWidthPct(raw.chatWidthPct ?? DEFAULT_LAYOUT.chatWidthPct),
    dockHeight,
    sidebarHidden: Boolean(raw.sidebarHidden),
    chatHidden: Boolean(raw.chatHidden),
    dockHidden: Boolean(raw.dockHidden),
    focus: Boolean(raw.focus),
  };
}

/**
 * @param {Partial<LayoutPrefs> | undefined} layout
 * @param {HTMLElement} [root]
 * @returns {LayoutPrefs}
 */
export function applyLayoutVars(layout, root = document.documentElement) {
  const prefs = normalizeLayout(layout);
  root.style.setProperty("--sidebar-width", `${prefs.sidebarWidth}px`);
  root.style.setProperty("--chat-dock-width", `min(600px, ${prefs.chatWidthPct}%)`);
  root.style.setProperty("--dock-height", `${prefs.dockHeight}px`);
  document.body?.classList.toggle("sidebar-hidden", prefs.sidebarHidden);
  document.body?.classList.toggle("chat-hidden", prefs.chatHidden);
  document.body?.classList.toggle("dock-hidden", prefs.dockHidden);
  if (document.body) document.body.dataset.layoutPreset = prefs.focus ? "focus" : "workbench";
  return prefs;
}
