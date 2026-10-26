// ABOUTME: Renders the queue of steering and follow-up messages as one list on top of the composer.
// ABOUTME: Rows can be edited, sent now, removed, and moved within their kind (drag or Alt+Arrow).

import { t } from "../i18n/i18n.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";
import { createIcon, setButtonIcon } from "../ui/icons.js";

/**
 * @typedef {{ label: string, message: string, kind: string, index: number }} QueuedMessageItem
 * @typedef {{
 *   onCancel?: ((item: QueuedMessageItem) => void) | null,
 *   onEdit?: ((item: QueuedMessageItem) => void) | null,
 *   onSendNow?: ((item: QueuedMessageItem) => void) | null,
 *   onReorder?: ((item: QueuedMessageItem, to: number) => void) | null,
 * }} QueueActions
 */

const REFOCUS_MS = 2000;

let collapsed = false;
// A reorder clears Pi's queue and sends it back one message at a time, so several renders
// follow; the moved row keeps focus through all of them.
/** @type {{ kind: string, message: string, until: number } | null} */
let focusAfterRender = null;
/** @type {((item: QueuedMessageItem) => void) | null} */
let queueSendNow = null;

/**
 * @param {Element | null | undefined} container
 * @param {{ steering?: unknown, followUp?: unknown } | null | undefined} [queue]
 * @param {QueueActions} [actions]
 */
export function renderQueuedMessages(container, queue = {}, actions = {}) {
  if (!container) return;
  const itemsQueue = queue ?? {};
  const steering = normalizeQueueItems(
    Array.isArray(itemsQueue.steering) ? itemsQueue.steering : [],
    t("composer.queuedSteering"),
    "steer",
  );
  const followUp = normalizeQueueItems(
    Array.isArray(itemsQueue.followUp) ? itemsQueue.followUp : [],
    t("composer.queuedFollowUp"),
    "follow_up",
  );
  const items = [...steering, ...followUp];
  container.replaceChildren();
  container.classList.toggle("hidden", items.length === 0);
  if (!items.length) return;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "queued-header";
  header.setAttribute("aria-expanded", String(!collapsed));
  header.append(
    createIcon("chevron-down", { size: 14 }) ?? "",
    t("composer.queue.header", { count: items.length }),
  );
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    renderQueuedMessages(container, queue, actions);
  });
  container.append(header);
  if (collapsed) return;

  const list = document.createElement("div");
  list.className = "queued-list";
  list.setAttribute("role", "list");
  const counts = { steer: steering.length, follow_up: followUp.length };
  const refocus = focusAfterRender && Date.now() < focusAfterRender.until ? focusAfterRender : null;
  if (!refocus) focusAfterRender = null;
  const active = document.activeElement;
  const focusFree = !active || active === document.body || container.contains(active);
  for (const item of items) {
    const row = renderRow(item, counts[/** @type {"steer" | "follow_up"} */ (item.kind)], actions);
    list.append(row);
    if (focusFree && refocus?.kind === item.kind && refocus.message === item.message) {
      queueMicrotask(() => row.focus());
    }
  }
  container.append(list);
}

/**
 * @param {QueuedMessageItem} item
 * @param {number} kindCount
 * @param {QueueActions} actions
 */
function renderRow(item, kindCount, { onCancel, onEdit, onSendNow, onReorder }) {
  const row = document.createElement("div");
  row.className = "queued-msg";
  row.tabIndex = 0;
  row.setAttribute("role", "listitem");
  row.dataset.kind = item.kind;
  row.dataset.index = String(item.index);
  row.title = item.message;

  const kind = document.createElement("span");
  kind.className = "queued-msg-kind";
  kind.title = t(
    item.kind === "steer" ? "composer.queue.steerTitle" : "composer.queue.followUpTitle",
  );
  kind.setAttribute("aria-label", item.label);
  const kindIcon = createIcon(item.kind === "steer" ? "corner-down-right" : "clock", { size: 14 });
  if (kindIcon) kind.append(kindIcon);

  const text = document.createElement("span");
  text.className = "queued-msg-text";
  text.textContent = item.message;

  const grip = iconButton("queued-msg-grip", "grip-vertical", t("composer.queue.reorder"));
  const edit = iconButton("queued-msg-edit", "pencil", t("composer.editQueued"));
  const sendNow = iconButton("queued-msg-send", "arrow-up", t("composer.sendNow"));
  sendNow.title = t("composer.sendNowTitle");
  const cancel = iconButton("queued-msg-cancel", "x", t("composer.removeQueued"));

  edit.addEventListener("click", () => {
    (onEdit ?? editQueuedIntoComposer)(item);
    onCancel?.(item);
  });
  sendNow.addEventListener("click", () => (onSendNow ?? queueSendNow)?.(item));
  cancel.addEventListener("click", () => onCancel?.(item));

  row.addEventListener("keydown", (event) => {
    if (!event.altKey || !onReorder) return;
    const to =
      event.key === "ArrowUp" ? item.index - 1 : event.key === "ArrowDown" ? item.index + 1 : -1;
    if (to < 0 || to >= kindCount) return;
    event.preventDefault();
    focusAfterRender = { kind: item.kind, message: item.message, until: Date.now() + REFOCUS_MS };
    onReorder(item, to);
  });
  grip.addEventListener("pointerdown", (event) => {
    if (onReorder) startDrag(event, row, item, onReorder);
  });

  row.append(grip, kind, text, edit, sendNow, cancel);
  return row;
}

/**
 * @param {string} className
 * @param {string} icon
 * @param {string} label
 */
function iconButton(className, icon, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-icon-button ui-icon-button--xs ui-icon-button--ghost ${className}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  setButtonIcon(button, icon, { size: 14 });
  return button;
}

/**
 * Drag within the rows of the same kind; a line shows where the row will land.
 * @param {PointerEvent} event
 * @param {HTMLElement} row
 * @param {QueuedMessageItem} item
 * @param {(item: QueuedMessageItem, to: number) => void} onReorder
 */
function startDrag(event, row, item, onReorder) {
  event.preventDefault();
  const peers = /** @type {HTMLElement[]} */ ([
    ...(row.parentElement?.querySelectorAll(`.queued-msg[data-kind="${item.kind}"]`) ?? []),
  ]);
  const rects = peers.map((peer) => peer.getBoundingClientRect());
  let to = item.index;
  row.classList.add("dragging");
  row.setPointerCapture?.(event.pointerId);
  /** @param {PointerEvent} moveEvent */
  const move = (moveEvent) => {
    to = dropIndex(rects, moveEvent.clientY, item.index);
    for (const [index, peer] of peers.entries()) {
      peer.classList.toggle("drop-before", index === to && to < item.index);
      peer.classList.toggle("drop-after", index === to && to > item.index);
    }
  };
  const end = () => {
    row.removeEventListener("pointermove", move);
    row.removeEventListener("pointerup", end);
    row.removeEventListener("pointercancel", end);
    for (const peer of peers) peer.classList.remove("dragging", "drop-before", "drop-after");
    if (to !== item.index) onReorder(item, to);
  };
  row.addEventListener("pointermove", move);
  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
}

/**
 * The index a dragged row lands on: the first row whose middle is below the pointer.
 * @param {DOMRect[]} rects
 * @param {number} y
 * @param {number} from
 */
function dropIndex(rects, y, from) {
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index];
    if (!rect) continue;
    if (y < rect.top + rect.height / 2) return index > from ? index - 1 : index;
  }
  return rects.length - 1;
}

/** @param {(item: QueuedMessageItem) => void} handler */
export function registerQueueSendNow(handler) {
  queueSendNow = handler;
}

/**
 * Puts a queued line into the composer so the user can change it.
 *
 * @param {QueuedMessageItem} item
 */
function editQueuedIntoComposer(item) {
  const input = composerChromeRefs().messageInput;
  if (input instanceof HTMLTextAreaElement) {
    input.value = item.message;
    input.focus();
  }
}

/**
 * @param {readonly unknown[] | null | undefined} messages
 * @param {string} label
 * @param {string} kind
 * @returns {QueuedMessageItem[]}
 */
function normalizeQueueItems(messages, label, kind) {
  return (messages ?? [])
    .map((message) => String(message ?? "").trim())
    .filter(Boolean)
    .map((message, index) => ({ label, message, kind, index }));
}
