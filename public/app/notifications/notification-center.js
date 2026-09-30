// ABOUTME: Stacks in-app notices and removes them when they are dismissed.
// ABOUTME: It does not call the operating system notification API.

import { t } from "../i18n/i18n.js";

const DEFAULT_DURATION_MS = 8000;

/**
 * @typedef {{
 *   title?: string,
 *   type?: string,
 *   message?: string,
 *   detail?: string,
 *   duration?: number,
 *   action?: { label: string, onClick: () => void },
 * }} Notice
 * @param {unknown} input
 * @returns {Notice}
 */
function normalizeNotification(input) {
  if (typeof input === "string") return { title: input };
  if (input && typeof input === "object") return /** @type {Notice} */ (input);
  return { title: "Notification" };
}

/**
 * @param {{ root?: ParentNode, duration?: number }} [options]
 */
export function createNotificationCenter({
  root = document.body,
  duration = DEFAULT_DURATION_MS,
} = {}) {
  let stack = root.querySelector(".notification-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "notification-stack";
    stack.setAttribute("aria-live", "polite");
    stack.setAttribute("aria-relevant", "additions");
    root.appendChild(stack);
  }
  const stackEl = stack;

  /** @param {unknown} input */
  function notify(input) {
    const notification = normalizeNotification(input);
    const type = notification.type || "info";
    const card = document.createElement("div");
    card.className = `notification notification--${type}`;
    card.setAttribute("role", type === "error" ? "alert" : "status");

    const content = document.createElement("div");
    content.className = "notification-content";

    const title = document.createElement("div");
    title.className = "notification-title";
    title.textContent = notification.title || "Notification";
    content.appendChild(title);

    if (notification.message) {
      const message = document.createElement("div");
      message.className = "notification-message";
      message.textContent = notification.message;
      content.appendChild(message);
    }

    if (notification.detail) {
      const detail = document.createElement("div");
      detail.className = "notification-detail";
      detail.textContent = notification.detail;
      content.appendChild(detail);
    }

    /** @type {HTMLButtonElement | null} */
    let actionButton = null;
    if (notification.action?.label) {
      actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "ui-button ui-button--ghost ui-button--sm notification-action";
      actionButton.textContent = notification.action.label;
      content.appendChild(actionButton);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "notification-close";
    close.setAttribute("aria-label", t("notifications.center.dismissNotificationLabel"));
    close.textContent = "×";

    card.appendChild(content);
    card.appendChild(close);
    if (!stackEl.isConnected) root.appendChild(stackEl);
    stackEl.appendChild(card);

    /** @type {number | null} */
    let timeoutId = null;
    const dismiss = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      card.remove();
      if (!stackEl.children.length) stackEl.remove();
    };

    close.addEventListener("click", dismiss);
    actionButton?.addEventListener("click", () => {
      dismiss();
      notification.action?.onClick();
    });

    const notificationDuration = notification.duration ?? duration;
    if (notificationDuration > 0) {
      timeoutId = window.setTimeout(dismiss, notificationDuration);
    }

    return { element: card, dismiss };
  }

  return { notify };
}
