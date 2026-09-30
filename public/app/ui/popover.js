// ABOUTME: Anchored in-app popover with one open surface at a time.
// ABOUTME: Escape, an outside click, or the anchor again closes it and restores focus.

import { randomId } from "../utils/random-id.js";
import { el } from "./dom.js";

/**
 * @typedef {{ anchor: HTMLElement, close: () => void }} OpenPopover
 */

/** @type {OpenPopover | null} */
let current = null;

/**
 * @param {HTMLElement} dialog
 * @param {HTMLElement} anchor
 */
function placePopover(dialog, anchor) {
  const margin = 8;
  const anchorRect = anchor.getBoundingClientRect();
  const dialogRect = dialog.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  const maxLeft = window.innerWidth - dialogRect.width - margin;
  if (left > maxLeft) left = Math.max(margin, maxLeft);
  if (left < margin) left = margin;
  const above = anchorRect.top - dialogRect.height - margin;
  if (top + dialogRect.height > window.innerHeight - margin && above >= margin) top = above;
  dialog.style.left = `${Math.round(left)}px`;
  dialog.style.top = `${Math.round(top)}px`;
}

/**
 * Open a non-modal popover anchored to `anchor`. Returns a close function.
 * Calling it again for the same anchor closes the popover.
 * @param {HTMLElement} anchor
 * @param {{ title?: string, body?: Node | null }} [options]
 * @returns {() => void}
 */
export function openPopover(anchor, { title = "", body = null } = {}) {
  if (current?.anchor === anchor) {
    const closeCurrent = current.close;
    closeCurrent();
    return closeCurrent;
  }
  current?.close();

  const titleId = `ui-popover-title-${randomId()}`;
  const dialog = /** @type {HTMLElement} */ (
    el(
      "div",
      {
        class: "ui-popover",
        id: `ui-popover-${randomId()}`,
        role: "dialog",
        tabindex: "-1",
        "aria-labelledby": titleId,
      },
      [
        el("h2", { class: "ui-popover-title", id: titleId, text: title }),
        el("div", { class: "ui-popover-body" }, body ? [body] : []),
      ],
    )
  );

  let disposed = false;

  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  };

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    const target = event.target;
    if (target instanceof Node && (anchor.contains(target) || dialog.contains(target))) return;
    close();
  };

  const close = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("click", onClick);
    if (current?.close === close) current = null;
    dialog.remove();
    anchor.setAttribute("aria-expanded", "false");
    anchor.removeAttribute("aria-controls");
    if (anchor.isConnected) anchor.focus();
  };

  current = { anchor, close };
  document.body.append(dialog);
  anchor.setAttribute("aria-expanded", "true");
  anchor.setAttribute("aria-controls", dialog.id);
  placePopover(dialog, anchor);
  dialog.focus();
  document.addEventListener("keydown", onKeyDown, true);
  queueMicrotask(() => {
    if (!disposed) document.addEventListener("click", onClick);
  });
  return close;
}
