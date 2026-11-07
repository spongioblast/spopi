// ABOUTME: Folds long user prompts to a few lines with a Show more / Show less control inside the bubble.
// ABOUTME: Owns the fold state and its overflow check; message-renderer.js decides which messages get one.

import { t } from "../i18n/i18n.js";
import { shouldCollapseUserMessage } from "./message-format.js";

const FOLDABLE = "user-message-collapsible";
const OVERFLOWING = "user-message-overflowing";
const TOGGLE = "message-user-collapse-toggle";

/** @type {ResizeObserver | null} */
let observer = null;

/**
 * @param {HTMLElement} contentEl
 */
function measure(contentEl) {
  if (contentEl.classList.contains("expanded")) return;
  // Without layout (detached, hidden tab, tests) keep the fold as rendered.
  if (contentEl.clientHeight === 0) return;
  const overflowing = contentEl.scrollHeight > contentEl.clientHeight + 1;
  contentEl.classList.toggle(OVERFLOWING, overflowing);
  const toggle = contentEl.querySelector(`.${TOGGLE}`);
  if (toggle instanceof HTMLElement) toggle.hidden = !overflowing;
}

/**
 * @param {HTMLElement} contentEl
 */
function watch(contentEl) {
  if (typeof ResizeObserver !== "function") return;
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const target = /** @type {HTMLElement} */ (entry.target);
      if (!target.isConnected) {
        observer?.unobserve(target);
        continue;
      }
      measure(target);
    }
  });
  observer.observe(contentEl);
}

/**
 * @param {HTMLElement} toggle
 * @param {boolean} expanded
 */
function labelToggle(toggle, expanded) {
  const label = t(expanded ? "messages.collapse" : "messages.expand");
  toggle.dataset.label = label;
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("aria-expanded", String(expanded));
}

/**
 * Open or close a folded prompt. No-op for prompts without a fold.
 * @param {Element} contentEl
 * @param {boolean} expanded
 */
export function setUserMessageExpanded(contentEl, expanded) {
  if (!(contentEl instanceof HTMLElement) || !contentEl.classList.contains(FOLDABLE)) return;
  contentEl.classList.toggle("expanded", expanded);
  const toggle = contentEl.querySelector(`.${TOGGLE}`);
  if (toggle instanceof HTMLElement) labelToggle(toggle, expanded);
  if (!expanded) measure(contentEl);
}

/**
 * Re-label every fold toggle under a container after a locale change.
 * @param {ParentNode} container
 */
export function relabelUserMessageFolds(container) {
  container.querySelectorAll(`.${TOGGLE}`).forEach((toggle) => {
    if (!(toggle instanceof HTMLElement)) return;
    labelToggle(toggle, toggle.getAttribute("aria-expanded") === "true");
  });
}

/**
 * Fold a rendered user prompt when it is long. The label is CSS generated
 * content, so copy and chat search never see it as message text.
 * @param {HTMLElement} contentEl
 * @param {string} rawContent
 * @returns {boolean} whether the prompt got a fold
 */
export function foldLongUserMessage(contentEl, rawContent) {
  if (!shouldCollapseUserMessage(rawContent)) return false;

  contentEl.classList.add(FOLDABLE, OVERFLOWING);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = TOGGLE;
  labelToggle(toggle, false);
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setUserMessageExpanded(contentEl, !contentEl.classList.contains("expanded"));
  });
  contentEl.appendChild(toggle);

  contentEl.addEventListener("click", (event) => {
    if (contentEl.classList.contains("expanded")) return;
    if (!contentEl.classList.contains(OVERFLOWING)) return;
    const target = event.target;
    if (target instanceof Element && target.closest("a, button")) return;
    // A drag that selected text is not a request to unfold.
    if (window.getSelection()?.isCollapsed === false) return;
    setUserMessageExpanded(contentEl, true);
  });

  watch(contentEl);
  return true;
}
