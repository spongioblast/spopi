// ABOUTME: Builds assistant thinking blocks, their toggles, and the live thinking block of a streaming message.
// ABOUTME: Tracks where each streaming message's thinking is placed; message-renderer.js owns the message itself.

import { t } from "../i18n/i18n.js";
import { formatUsd } from "./formatters.js";
import { appendMarkup } from "./message-markup.js";
import { escapeHtml } from "./sanitize-markup.js";

const CHEVRON_ICON =
  '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><path d="M2 1l4 3-4 3z"/></svg>';
const BRAIN_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M6.5 9h11"/><path d="M7 13h10"/></svg>';

/** Where a streaming message's thinking goes, when it is not the message itself. */
/** @type {WeakMap<HTMLElement, HTMLElement>} */
const thinkingHosts = new WeakMap();
/** The thinking block a streaming message owns, wherever it was placed. */
/** @type {WeakMap<HTMLElement, HTMLElement>} */
const thinkingBlocks = new WeakMap();

/**
 * @param {number | null | undefined} cost
 */
function thinkingCostHtml(cost) {
  if (!(cost != null && cost > 0)) return "";
  return `<span class="thinking-usage" title="Total cost for this response">${formatUsd(cost, 4)}</span>`;
}

/**
 * @param {string | undefined} thinking
 * @param {number | null | undefined} cost
 */
export function thinkingBlockHtml(thinking, cost) {
  const costHtml = thinkingCostHtml(cost);
  return `<div class="thinking-block"><button type="button" class="thinking-toggle" data-thinking-toggle="true"><span class="chevron">${CHEVRON_ICON}</span><span class="thinking-label">${BRAIN_ICON} <span class="thinking-label-text">${escapeHtml(t("messages.thinking"))}</span></span>${costHtml}</button><div class="thinking-content">${escapeHtml(thinking)}</div></div>`;
}

/**
 * @param {HTMLElement} root
 */
export function enableThinkingToggles(root) {
  root.querySelectorAll(".thinking-label-text").forEach((label) => {
    if (!(label instanceof HTMLElement)) return;
    label.textContent = t("messages.thinking");
  });
  root.querySelectorAll("[data-thinking-toggle]").forEach((toggle) => {
    if (!(toggle instanceof HTMLElement)) return;
    if (toggle.dataset.bound === "true") return;
    const toggleEl = toggle;
    const toggleThinking = () => {
      const block = toggleEl.closest(".thinking-block");
      const content = block?.querySelector(".thinking-content");
      content?.classList.toggle("expanded");
      toggleEl.classList.toggle("expanded");
    };
    toggleEl.addEventListener("click", toggleThinking);
    toggleEl.dataset.bound = "true";
  });
}

/**
 * @param {HTMLElement} messageElement
 * @param {HTMLElement | null} host
 */
export function setThinkingHost(messageElement, host) {
  if (host) thinkingHosts.set(messageElement, host);
  else thinkingHosts.delete(messageElement);
}

/**
 * Writes the streamed thinking into the message's live block, creating it on first use.
 * @param {HTMLElement} messageElement
 * @param {string} thinking
 * @returns {boolean} true when the thinking text was written
 */
export function updateStreamingThinkingBlock(messageElement, thinking) {
  const owned = thinkingBlocks.get(messageElement);
  const existing = owned || messageElement.querySelector(".streaming-thinking");
  /** @type {HTMLElement | null} */
  let thinkingDiv = existing instanceof HTMLElement ? existing : null;
  if (!thinkingDiv) {
    const contentDiv = messageElement.querySelector(".message-content");
    if (!(contentDiv instanceof HTMLElement)) return false;
    thinkingDiv = document.createElement("div");
    thinkingDiv.className = "thinking-block streaming-thinking";
    appendMarkup(
      thinkingDiv,
      `<button type="button" class="thinking-toggle expanded" data-thinking-toggle="true"><span class="chevron">${CHEVRON_ICON}</span><span class="thinking-label">${BRAIN_ICON} <span class="thinking-label-text">${escapeHtml(t("messages.thinking"))}</span></span></button><div class="thinking-content expanded"></div>`,
    );
    const host = thinkingHosts.get(messageElement);
    // In an opened work row the step's text streams there too: its thought goes first.
    if (host && messageElement.parentElement === host)
      host.insertBefore(thinkingDiv, messageElement);
    else if (host) host.appendChild(thinkingDiv);
    else contentDiv.prepend(thinkingDiv);
    thinkingBlocks.set(messageElement, thinkingDiv);
    enableThinkingToggles(thinkingDiv);
  }
  const contentEl = thinkingDiv.querySelector(".thinking-content");
  if (!(contentEl instanceof HTMLElement)) return false;
  if (contentEl.dataset.scrollBound !== "true") {
    contentEl.dataset.scrollBound = "true";
    const scrollEl = contentEl;
    scrollEl.addEventListener("scroll", () => {
      const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      scrollEl.dataset.pinned = gap < 32 ? "1" : "0";
    });
  }
  const follow = contentEl.dataset.pinned !== "0";
  contentEl.textContent = thinking;
  if (follow) contentEl.scrollTop = contentEl.scrollHeight;
  return true;
}

/**
 * Ends the live thinking of a finished message and forgets its host.
 * @param {HTMLElement} messageElement
 * @returns {HTMLElement | null} the block it owned, now settled in place
 */
export function releaseThinkingBlock(messageElement) {
  const hosted = thinkingBlocks.get(messageElement);
  if (hosted) {
    hosted.classList.remove("streaming-thinking");
    thinkingBlocks.delete(messageElement);
  }
  thinkingHosts.delete(messageElement);
  return hosted ?? null;
}
