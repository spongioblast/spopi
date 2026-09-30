// ABOUTME: Renders messages waiting to be sent as steering or follow-up.
// ABOUTME: Removing a row drops it from the queue. Edit moves the text into the composer.

import { t } from "../i18n/i18n.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";
import { setButtonIcon } from "../ui/icons.js";

/**
 * @typedef {{ label: string, message: string, kind: string, index: number }} QueuedMessageItem
 */

/**
 * @param {Element | null | undefined} container
 * @param {{ steering?: unknown, followUp?: unknown } | null | undefined} [queue]
 * @param {object} [options]
 * @param {((item: QueuedMessageItem) => void) | null | undefined} [options.onCancel]
 * @param {((item: QueuedMessageItem) => void) | null | undefined} [options.onEdit]
 * @param {((item: QueuedMessageItem) => void) | null | undefined} [options.onSendNow]
 */
export function renderQueuedMessages(container, queue = {}, { onCancel, onEdit, onSendNow } = {}) {
  if (!container) return;
  const itemsQueue = queue ?? {};

  container.innerHTML = "";
  const items = [
    ...normalizeQueueItems(
      Array.isArray(itemsQueue.steering) ? itemsQueue.steering : [],
      t("composer.queuedSteering"),
      "steer",
    ),
    ...normalizeQueueItems(
      Array.isArray(itemsQueue.followUp) ? itemsQueue.followUp : [],
      t("composer.queuedFollowUp"),
      "follow_up",
    ),
  ];

  container.classList.toggle("hidden", items.length === 0);
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "queued-msg queued-pill";

    const label = document.createElement("span");
    label.className = "queued-msg-label";
    label.textContent = item.label;

    const text = document.createElement("span");
    text.className = "queued-msg-text";
    text.textContent = item.message;

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ui-button ui-button--xs ui-button--ghost queued-msg-edit";
    edit.textContent = t("composer.editQueued");
    edit.addEventListener("click", () => {
      (onEdit ?? editQueuedIntoComposer)(item);
      onCancel?.(item);
    });

    const sendNow = document.createElement("button");
    sendNow.type = "button";
    sendNow.className = "ui-button ui-button--xs ui-button--ghost queued-msg-send";
    sendNow.textContent = t("composer.sendNow");
    sendNow.addEventListener("click", () => (onSendNow ?? queueSendNow)?.(item));

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ui-icon-button ui-icon-button--xs ui-icon-button--ghost queued-msg-cancel";
    cancel.title = t("composer.removeQueued");
    cancel.setAttribute("aria-label", t("composer.removeQueued"));
    setButtonIcon(cancel, "x", { size: 14 });
    cancel.addEventListener("click", () => onCancel?.(item));

    row.append(label, text, edit, sendNow, cancel);
    container.appendChild(row);
  }
}

/** @type {((item: QueuedMessageItem) => void) | null} */
let queueSendNow = null;

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
