// ABOUTME: Shows the latest assistant token usage above the composer.
// ABOUTME: The numbers come from the last usage block in the transcript.

import { t } from "../i18n/i18n.js";
import { headerChromeRefs } from "../shell/chrome/chat.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";
import { formatTokens, mountContextViz } from "../ui/context-viz.js";

// Mirrors Pi's DEFAULT_COMPACTION_SETTINGS.keepRecentTokens. Below this
// boundary prepareCompaction() has no older context to summarize.
const MIN_COMPACTABLE_CONTEXT_TOKENS = 20_000;

/**
 * @typedef {{
 *   input?: number,
 *   output?: number,
 *   cacheRead?: number,
 *   contextWindow?: number,
 * }} UsageSnapshot
 */

/**
 * @param {object} [options]
 * @param {Element | null} [options.tokenUsageEl]
 * @param {Element | null} [options.contextViz]
 * @param {Element | null} [options.contextBar]
 * @param {Element | null} [options.contextLegend]
 * @param {Element | null} [options.contextVizUsed]
 * @param {Element | null} [options.contextVizTotal]
 * @param {Element | null} [options.compactButton]
 */
export function mountContextUsage({
  tokenUsageEl,
  contextViz,
  contextBar,
  contextLegend,
  contextVizUsed,
  contextVizTotal,
  compactButton,
} = {}) {
  const header = headerChromeRefs();
  tokenUsageEl ??= header.tokenUsage;
  contextViz ??= header.contextViz;
  contextBar ??= header.contextBar;
  contextLegend ??= header.contextLegend;
  contextVizUsed ??= header.contextVizUsed;
  contextVizTotal ??= header.contextVizTotal;
  compactButton ??= header.compactContextBtn;
  /** @type {HTMLElement | null} */
  const tokenUsage = tokenUsageEl instanceof HTMLElement ? tokenUsageEl : null;
  /** @type {HTMLElement | null} */
  const vizRoot = contextViz instanceof HTMLElement ? contextViz : null;
  /** @type {HTMLElement | null} */
  const vizBar = contextBar instanceof HTMLElement ? contextBar : null;
  /** @type {HTMLElement | null} */
  const vizLegend = contextLegend instanceof HTMLElement ? contextLegend : null;
  /** @type {HTMLElement | null} */
  const vizUsed = contextVizUsed instanceof HTMLElement ? contextVizUsed : null;
  /** @type {HTMLElement | null} */
  const vizTotal = contextVizTotal instanceof HTMLElement ? contextVizTotal : null;
  /** @type {HTMLButtonElement | null} */
  const compactBtn = compactButton instanceof HTMLButtonElement ? compactButton : null;
  /** @type {UsageSnapshot | null} */
  let usage = null;
  let contextWindowSize = 0;
  let compacting = false;
  let working = false;
  let sessionTokens = { input: 0, output: 0 };

  const viz = mountContextViz({
    tokenUsageEl: tokenUsage,
    contextViz: vizRoot,
    contextBar: vizBar,
    contextLegend: vizLegend,
    contextVizUsed: vizUsed,
    contextVizTotal: vizTotal,
    getUsage: () => usage,
    getContextWindowSize: () => contextWindowSize,
    getSessionTotals: () => sessionTokens,
  });

  /**
   * @param {UsageSnapshot | null | undefined} nextUsage
   * @param {number} [nextContextWindowSize]
   */
  function setUsage(nextUsage, nextContextWindowSize = contextWindowSize) {
    usage = normalizeUsage(nextUsage);
    contextWindowSize = Number(nextContextWindowSize) || Number(usage?.contextWindow) || 0;
    renderPill();
    if (!vizRoot?.classList.contains("hidden")) viz.update();
  }

  /** @param {number} nextContextWindowSize */
  function setContextWindowSize(nextContextWindowSize) {
    contextWindowSize = Number(nextContextWindowSize) || 0;
    renderPill();
    if (!vizRoot?.classList.contains("hidden")) viz.update();
  }

  /** @param {{ input?: number, output?: number }} [next] */
  function setSessionTotals(next = {}) {
    sessionTokens = {
      input: Number(next.input) || 0,
      output: Number(next.output) || 0,
    };
    renderPill();
    if (!vizRoot?.classList.contains("hidden")) viz.update();
  }

  function clear() {
    usage = null;
    contextWindowSize = 0;
    sessionTokens = { input: 0, output: 0 };
    tokenUsage?.classList.remove("visible", "warning", "critical");
    if (tokenUsage) {
      tokenUsage.textContent = "";
      tokenUsage.title = t("usage.contextTitle");
    }
    viz.hide();
    renderCompactButton();
    paintContextRing();
  }

  function renderCompactButton() {
    if (!compactBtn) return;
    compactBtn.hidden = usageTotal(usage) <= MIN_COMPACTABLE_CONTEXT_TOKENS;
    compactBtn.classList.toggle("compacting", compacting);
    compactBtn.disabled = compacting || working;
    compactBtn.setAttribute("aria-busy", String(compacting));
    const label = compactBtn.querySelector(".compact-btn-label");
    if (label) label.textContent = t(compacting ? "input.compacting" : "input.compact");
    const description = t(compacting ? "input.compacting" : "input.compactDesc");
    compactBtn.title = description;
    compactBtn.setAttribute("aria-label", description);
  }

  function paintContextRing() {
    const ring = composerChromeRefs().contextRing;
    if (!(ring instanceof HTMLElement)) return;
    const used = usageTotal(usage);
    const percent =
      used > 0 && contextWindowSize > 0
        ? Math.min(100, Math.round((used / contextWindowSize) * 100))
        : 0;
    ring.style.setProperty("--context-pct", String(percent));
    ring.dataset.level = percent >= 95 ? "critical" : percent >= 80 ? "warning" : "ok";
    const summary =
      contextWindowSize > 0
        ? `${t("composer.context")}: ${formatTokens(used)} / ${formatTokens(contextWindowSize)} (${percent}%)`
        : t("composer.context");
    ring.title = summary;
    ring.setAttribute("aria-label", summary);
  }

  function renderPill() {
    renderCompactButton();
    paintContextRing();
    if (!tokenUsage) return;
    tokenUsage.classList.remove("warning", "critical");

    const used = usageTotal(usage);
    const parts = [];
    if (sessionTokens.input > 0) {
      parts.push(t("usage.inputSummary", { in: formatTokens(sessionTokens.input) }));
    }
    if (sessionTokens.output > 0) {
      parts.push(t("usage.outputSummary", { out: formatTokens(sessionTokens.output) }));
    }

    let percent = null;
    if (used > 0 && contextWindowSize > 0) {
      percent = Math.round((used / contextWindowSize) * 100);
      parts.push(`${percent}%`);
      if (percent >= 80) tokenUsage.classList.add("critical");
      else if (percent >= 60) tokenUsage.classList.add("warning");
    } else if (used > 0) {
      parts.push(formatTokens(used));
    }

    if (parts.length === 0) {
      tokenUsage.classList.remove("visible");
      tokenUsage.textContent = "";
      tokenUsage.title = t("usage.contextTitle");
      viz.hide();
      return;
    }

    tokenUsage.classList.add("visible");
    tokenUsage.textContent = parts.join(" · ");
    tokenUsage.title = pillTitle(used);
  }

  /** @param {number} used */
  function pillTitle(used) {
    const details = [];
    if (sessionTokens.input > 0) {
      details.push(t("usage.inputSummary", { in: formatTokens(sessionTokens.input) }));
    }
    if (sessionTokens.output > 0) {
      details.push(t("usage.outputSummary", { out: formatTokens(sessionTokens.output) }));
    }
    if (used > 0 && contextWindowSize > 0) {
      details.push(
        t("usage.contextOfWindow", {
          used: formatTokens(used),
          window: formatTokens(contextWindowSize),
        }),
      );
    } else if (used > 0) {
      details.push(t("usage.contextUsed", { used: formatTokens(used) }));
    }
    return details.length > 0 ? details.join(" · ") : t("usage.contextTitle");
  }

  return {
    clear,
    get canCompact() {
      return usageTotal(usage) > MIN_COMPACTABLE_CONTEXT_TOKENS;
    },
    /** @param {unknown} value */
    setCompacting(value) {
      compacting = Boolean(value);
      renderCompactButton();
    },
    /** @param {unknown} value */
    setWorking(value) {
      working = Boolean(value);
      renderCompactButton();
    },
    setContextWindowSize,
    setSessionTotals,
    setUsage,
    get usage() {
      return usage;
    },
    get contextWindowSize() {
      return contextWindowSize;
    },
  };
}

/**
 * @param {unknown[] | null | undefined} messages
 */
export function findLatestAssistantUsage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = /** @type {{ role?: string, usage?: UsageSnapshot }} */ (message);
    if (record.role === "assistant" && record.usage) return record.usage;
  }
  return null;
}

/** @param {UsageSnapshot | null | undefined} usage */
function usageTotal(usage) {
  if (!usage) return 0;
  return (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0);
}

/** @param {UsageSnapshot | null | undefined} usage */
function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    ...usage,
    input: Number(usage.input) || 0,
    cacheRead: Number(usage.cacheRead) || 0,
  };
}
