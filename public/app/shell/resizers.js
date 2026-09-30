// ABOUTME: Drags the sidebar, chat, and dock splitters and reports the new size.
// ABOUTME: Each drag starts from the live layout and is saved once, on release.

import { clampChatWidthPct, clampDockHeight, clampSidebarWidth } from "./layout-prefs.js";

/**
 * @typedef {{ sidebarWidth: number, chatWidthPct: number, dockHeight: number }} LayoutSizes
 * @typedef {Partial<LayoutSizes>} LayoutPatch
 */

/**
 * @param {PointerEvent} event
 * @param {(next: PointerEvent) => void} onMove
 * @param {() => void} onEnd
 */
function startDrag(event, onMove, onEnd) {
  event.preventDefault();
  /** @param {PointerEvent} next */
  const move = (next) => onMove(next);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * The saved layout loads after mount, so every drag reads the live sizes from
 * `getLayout` instead of a copy taken at mount time.
 * @param {object} options
 * @param {Element | null | undefined} [options.sidebarHandle]
 * @param {Element | null | undefined} [options.chatHandle]
 * @param {Element | null | undefined} [options.dockHandle]
 * @param {() => LayoutSizes} options.getLayout
 * @param {(patch: LayoutPatch) => void} options.onResize applied on every move
 * @param {() => void} [options.onCommit] called once when the drag ends
 * @param {() => number | undefined} [options.getCenterHeight]
 */
export function mountLayoutResizers({
  sidebarHandle,
  chatHandle,
  dockHandle,
  getLayout,
  onResize,
  onCommit,
  getCenterHeight,
}) {
  /**
   * @param {Element | null | undefined} handle
   * @param {(start: LayoutSizes, down: PointerEvent, next: PointerEvent) => LayoutPatch} measure
   */
  const bind = (handle, measure) => {
    handle?.addEventListener("pointerdown", (event) => {
      const down = /** @type {PointerEvent} */ (event);
      const start = { ...getLayout() };
      handle.classList.add("dragging");
      startDrag(
        down,
        (next) => onResize(measure(start, down, next)),
        () => {
          handle.classList.remove("dragging");
          onCommit?.();
        },
      );
    });
  };
  bind(sidebarHandle, (start, down, next) => ({
    sidebarWidth: clampSidebarWidth(start.sidebarWidth + (next.clientX - down.clientX)),
  }));
  bind(chatHandle, (start, down, next) => {
    const total = document.documentElement.clientWidth || 1;
    const deltaPct = ((down.clientX - next.clientX) / total) * 100;
    return { chatWidthPct: clampChatWidthPct(start.chatWidthPct + deltaPct) };
  });
  bind(dockHandle, (start, down, next) => ({
    dockHeight: clampDockHeight(
      start.dockHeight + (down.clientY - next.clientY),
      getCenterHeight?.(),
    ),
  }));
}
