// ABOUTME: Lets a panel be dragged to a new width or height.
// ABOUTME: The size is reported to the caller; this module does not persist it.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";

const DEFAULT_MIN_WIDTH = 260;
const DEFAULT_MAX_WIDTH = 560;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** @type {Array<{ panel: HTMLElement, storageKey: string, defaultWidth: number, minWidth: number, maxWidth: number }>} */
const mountedPanels = [];

/** Re-apply widths after the preference cache loads. */
export function refreshResizablePanels() {
  for (const item of mountedPanels) {
    const width = clamp(
      readStoredWidth(item.storageKey) ?? item.defaultWidth,
      item.minWidth,
      item.maxWidth,
    );
    item.panel.style.setProperty("--panel-width", `${Math.round(width)}px`);
  }
}

/** @param {string} storageKey */
function readStoredWidth(storageKey) {
  if (!storageKey) return null;
  const stored = Number.parseInt(uiStore.getItem(storageKey) || "", 10);
  return Number.isFinite(stored) ? stored : null;
}

/**
 * @param {HTMLElement | null | undefined} panel
 * @param {{
 *   storageKey: string,
 *   defaultWidth: number,
 *   minWidth?: number,
 *   maxWidth?: number,
 *   side?: "left" | "right"
 * }} options
 */
export function mountResizablePanel(
  panel,
  {
    storageKey,
    defaultWidth,
    minWidth = DEFAULT_MIN_WIDTH,
    maxWidth = DEFAULT_MAX_WIDTH,
    // 'right' = panel is on the right edge (drag handle on left, drag left to grow)
    // 'left'  = panel is on the left edge (drag handle on right, drag right to grow)
    side = "right",
  },
) {
  if (!panel) return () => {};

  mountedPanels.push({ panel, storageKey, defaultWidth, minWidth, maxWidth });
  panel.classList.add("app-side-panel", "is-resizable");
  const initialWidth = clamp(readStoredWidth(storageKey) ?? defaultWidth, minWidth, maxWidth);
  setPanelWidth(panel, initialWidth, storageKey);

  const handle = /** @type {HTMLElement} */ (
    panel.querySelector(".app-side-panel-resize-handle") || document.createElement("div")
  );
  handle.className =
    side === "left"
      ? "app-side-panel-resize-handle app-side-panel-resize-handle--right-edge"
      : "app-side-panel-resize-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  const applyHandleTitle = () => {
    handle.setAttribute("title", t("shell.panel.resizeTitle"));
    handle.setAttribute("aria-label", t("shell.panel.resizeTitle"));
  };
  applyHandleTitle();
  const unsubscribeLocaleChange = onLocaleChange(applyHandleTitle);
  if (!handle.parentElement) {
    panel.append(handle);
  }

  let startX = 0;
  let startWidth = initialWidth;

  /** @param {PointerEvent} event */
  const onPointerMove = (event) => {
    // For right-edge panels: drag left (clientX decreases) → grow width → startX - clientX > 0
    // For left-edge panels:  drag right (clientX increases) → grow width → clientX - startX > 0
    const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
    const nextWidth = clamp(startWidth + delta, minWidth, maxWidth);
    setPanelWidth(panel, nextWidth, storageKey);
  };

  const onPointerUp = () => {
    document.body.classList.remove("is-resizing-side-panel");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  };

  /** @param {PointerEvent} event */
  const onPointerDown = (event) => {
    event.preventDefault();
    startX = event.clientX;
    startWidth = Number.parseInt(panel.style.getPropertyValue("--panel-width"), 10) || initialWidth;
    document.body.classList.add("is-resizing-side-panel");
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  handle.addEventListener("pointerdown", onPointerDown);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.body.classList.remove("is-resizing-side-panel");
    unsubscribeLocaleChange();
  };
}

/**
 * @param {HTMLElement} panel
 * @param {number} width
 * @param {string} storageKey
 */
function setPanelWidth(panel, width, storageKey) {
  panel.style.setProperty("--panel-width", `${Math.round(width)}px`);
  if (storageKey) {
    uiStore.setItem(storageKey, String(Math.round(width)));
  }
}
