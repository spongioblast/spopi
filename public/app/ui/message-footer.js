// ABOUTME: Builds message footer controls: copy, fork and edit, expand for long prompts, time, response time.
// ABOUTME: Each control is returned unplaced; message-renderer.js decides the footer order.

import { editMessage, forkMessage } from "../chat/message-actions.js";
import { t } from "../i18n/i18n.js";
import { copyText } from "./clipboard.js";
import { formatDuration } from "./formatters.js";
import { createIcon } from "./icons.js";
import {
  formatMessageTime,
  fullTimestampTitle,
  shouldCollapseUserMessage,
} from "./message-format.js";
import { appendMarkup } from "./message-markup.js";
import { escapeHtml } from "./sanitize-markup.js";

const COPY_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/** Copy button markup for footers rendered as one HTML string. */
export function copyMessageButtonHtml() {
  return `<button class="message-copy-btn" aria-label="${escapeHtml(t("messages.copyMessage"))}" title="${escapeHtml(t("messages.copyMessage"))}">${COPY_ICON}</button>`;
}

export function createCopyButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-copy-btn";
  button.setAttribute("aria-label", t("messages.copyMessage"));
  button.title = t("messages.copyMessage");
  appendMarkup(button, COPY_ICON);
  return button;
}

/**
 * @param {HTMLElement} messageEl
 */
export function copyableText(messageEl) {
  const content = messageEl.querySelector(".message-content");
  if (!content) return "";
  const clone = content.cloneNode(true);
  if (!(clone instanceof Element)) return "";
  clone.querySelectorAll(".thinking-block, .streaming-thinking").forEach((el) => {
    el.remove();
  });
  return (clone.textContent || "").trim();
}

/**
 * @param {HTMLElement} messageEl
 */
export function enableMessageCopy(messageEl) {
  const btn = messageEl.querySelector(".message-copy-btn");
  if (!(btn instanceof HTMLElement)) return;
  const copyBtn = btn;
  copyBtn.addEventListener("click", () => {
    const text = copyableText(messageEl);
    if (!text) return;
    copyText(text).then(() => {
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.classList.remove("copied");
      }, 1500);
    });
  });
}

/** Timestamp span for the message footer; null when there is no valid time. */
/**
 * @param {number | null | undefined} timestampMs
 */
export function createTimeSpan(timestampMs) {
  const label = formatMessageTime(timestampMs);
  if (!label) return null;
  const span = document.createElement("span");
  span.className = "message-time";
  span.textContent = label;
  const title = fullTimestampTitle(timestampMs);
  if (title) span.title = title;
  return span;
}

/**
 * Response-time span for the assistant footer; null when there's no duration to show.
 * SPOPI times generation client-side (message_start → message_end); pi's runtime
 * events carry no duration field of their own.
 * @param {number | null | undefined} durationMs
 */
export function createDurationSpan(durationMs) {
  const label = formatDuration(durationMs);
  if (!label) return null;
  const span = document.createElement("span");
  span.className = "message-duration";
  span.textContent = label;
  span.title = t("messages.responseTime");
  return span;
}

/** Create the expand/collapse control for long user prompts. */
/**
 * @param {HTMLElement} contentEl
 * @param {string} rawContent
 */
export function createUserCollapseToggle(contentEl, rawContent) {
  if (!shouldCollapseUserMessage(rawContent)) return null;

  contentEl.classList.add("user-message-collapsible");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-user-collapse-toggle";
  button.textContent = t("messages.expand");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => {
    const expanded = contentEl.classList.toggle("expanded");
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = t(expanded ? "messages.collapse" : "messages.expand");
  });
  return button;
}

/**
 * Fork / Edit action for user messages (Pi-native /fork and /tree-select
 * entry points). The buttons emit message.fork / message.edit with the Pi
 * entry id and the original prompt text.
 */
/**
 * @param {"fork" | "edit"} kind
 * @param {string} actionText
 */
export function createUserActionButton(kind, actionText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `message-action message-${kind}-btn`;
  button.setAttribute(
    "aria-label",
    t(kind === "fork" ? "messages.forkSession" : "messages.editMessage"),
  );
  button.title = t(kind === "fork" ? "messages.forkSession" : "messages.editMessage");
  const icon = createIcon(kind === "fork" ? "git-branch" : "pencil", { size: 12 });
  if (icon) button.appendChild(icon);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const host = button.closest("[data-entry-id]");
    const entryId = host instanceof HTMLElement ? host.dataset.entryId || null : null;
    const detail = { entryId, text: actionText, messageEl: button };
    if (kind === "fork") forkMessage(detail);
    else editMessage(detail);
  });
  return button;
}
