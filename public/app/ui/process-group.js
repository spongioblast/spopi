// ABOUTME: Collapsible wrapper that folds a turn's thinking/tool-call noise into one row.
// ABOUTME: Mirrors pi-web's "Process details" group — collapsed by default, expands on click.

import { t } from "../i18n/i18n.js";

const CHEVRON_ICON =
  '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><path d="M2 1l4 3-4 3z"/></svg>';

const CHECK_ICON =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 5.2l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Build a collapsed-by-default "Process details" group. Callers append
 * process content (thinking blocks, tool cards) into `body`, then call
 * `setLabel` once the final counts are known.
 *
 * `setStreaming(true)` marks the group as live (pulsing label, matching the
 * "thinking" shimmer other chat UIs use while a turn is in flight);
 * `markDone()` stops the pulse and shows a green checkmark once it settles.
 */
export function createProcessDetailsGroup({ expanded = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `process-details-group${expanded ? " expanded" : ""}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "process-details-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.innerHTML = CHEVRON_ICON;

  const label = document.createElement("span");
  label.className = "process-details-label";

  const check = document.createElement("span");
  check.className = "process-details-check";
  check.innerHTML = CHECK_ICON;

  toggle.append(chevron, label, check);

  const body = document.createElement("div");
  body.className = "process-details-body";

  wrapper.append(toggle, body);

  toggle.addEventListener("click", () => {
    const expanded = wrapper.classList.toggle("expanded");
    toggle.setAttribute("aria-expanded", String(expanded));
  });

  return {
    wrapper,
    body,
    /** @param {string} text */
    setLabel(text) {
      label.textContent = text;
    },
    /** @param {boolean} isStreaming */
    setStreaming(isStreaming) {
      wrapper.classList.toggle("streaming", isStreaming);
      if (isStreaming) wrapper.classList.remove("done");
    },
    markDone() {
      wrapper.classList.remove("streaming");
      wrapper.classList.add("done");
    },
    /** Once settled: flag a row that is thinking and nothing else, so Show thinking off hides all of it. */
    flagThinkingOnly() {
      let only = Boolean(body.querySelector(".thinking-block"));
      if (only) {
        const rest = /** @type {HTMLElement} */ (body.cloneNode(true));
        for (const block of rest.querySelectorAll(".thinking-block")) block.remove();
        only = rest.textContent?.trim() === "" && !rest.querySelector("img, .tool-card");
      }
      wrapper.classList.toggle("thinking-only", only);
    },
  };
}

/** Capture expanded groups by DOM order before history rendering replaces them. */
/** @param {ParentNode} container */
export function captureExpandedProcessGroups(container) {
  const expanded = new Set();
  const groups = container.querySelectorAll(":scope > .process-details-group");
  groups.forEach((group, index) => {
    if (group.classList.contains("expanded")) expanded.add(index);
  });
  return expanded;
}

/** Build the localized "Process details · N steps · M tool calls" summary line. */
/**
 * @param {number} stepCount
 * @param {number} toolCallCount
 */
export function summarizeProcessGroup(stepCount, toolCallCount) {
  const parts = [t("messages.processDetails")];
  if (stepCount > 0) {
    parts.push(
      stepCount === 1
        ? t("messages.processStep", { count: stepCount })
        : t("messages.processSteps", { count: stepCount }),
    );
  }
  if (toolCallCount > 0) {
    parts.push(
      toolCallCount === 1
        ? t("messages.processToolCall", { count: toolCallCount })
        : t("messages.processToolCalls", { count: toolCallCount }),
    );
  }
  return parts.join(" · ");
}
