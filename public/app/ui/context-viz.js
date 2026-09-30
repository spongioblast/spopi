// ABOUTME: Mounts the context-window popover and formats token counts.
// ABOUTME: The totals come from the caller.

import { t } from "../i18n/i18n.js";

/**
 * @param {{
 *   tokenUsageEl?: HTMLElement | null,
 *   contextViz?: HTMLElement | null,
 *   contextBar?: HTMLElement | null,
 *   contextLegend?: HTMLElement | null,
 *   contextVizUsed?: HTMLElement | null,
 *   contextVizTotal?: HTMLElement | null,
 *   getUsage?: () => { input?: number, cacheRead?: number, output?: number, contextWindow?: number } | null,
 *   getContextWindowSize?: () => number,
 *   getSessionTotals?: () => { output?: number } | null
 * }} options
 */
export function mountContextViz({
  tokenUsageEl,
  contextViz,
  contextBar,
  contextLegend,
  contextVizUsed,
  contextVizTotal,
  getUsage,
  getContextWindowSize,
  getSessionTotals,
}) {
  if (!tokenUsageEl || !contextViz) {
    return {
      update: () => {},
      hide: () => {},
    };
  }

  function updateContextViz() {
    const lastUsage = getUsage?.();
    const contextWindowSize =
      Number(getContextWindowSize?.()) || Number(lastUsage?.contextWindow) || 0;
    if (!lastUsage || contextWindowSize <= 0) return;

    const input = Number(lastUsage.input) || 0;
    const cacheRead = Number(lastUsage.cacheRead) || 0;
    const output = Number(getSessionTotals?.()?.output) || Number(lastUsage.output) || 0;
    const total = contextWindowSize;
    const totalUsed = input + cacheRead;
    const free = Math.max(0, total - totalUsed);

    const windowSegments = [
      { key: "cache", label: t("context.cached"), tokens: cacheRead, color: "cache" },
      { key: "input", label: t("context.input"), tokens: input, color: "input" },
      { key: "free", label: t("context.available"), tokens: free, color: "free" },
    ];
    const legendItems = [
      { key: "input", label: t("context.input"), tokens: input, color: "input" },
      { key: "output", label: t("context.output"), tokens: output, color: "output" },
      { key: "free", label: t("context.available"), tokens: free, color: "free" },
      { key: "cache", label: t("context.cached"), tokens: cacheRead, color: "cache" },
    ];

    if (contextBar) {
      contextBar.innerHTML = "";
      for (const segment of windowSegments) {
        if (segment.tokens <= 0) continue;
        const element = document.createElement("div");
        element.className = `context-bar-segment ${segment.color}`;
        element.style.width = `${(segment.tokens / total) * 100}%`;
        element.title = t("context.tooltip", {
          label: segment.label,
          tokens: formatTokens(segment.tokens),
        });
        contextBar.appendChild(element);
      }
    }

    if (contextLegend) {
      contextLegend.innerHTML = "";
      for (const segment of legendItems) {
        const item = document.createElement("div");
        item.className = "context-legend-item";

        const left = document.createElement("span");
        left.className = "context-legend-left";

        const dot = document.createElement("span");
        dot.className = `context-legend-dot ${segment.color}`;
        left.append(dot, segment.label);

        const value = document.createElement("span");
        value.className = "context-legend-value";
        value.textContent = formatTokens(segment.tokens);

        item.append(left, value);
        contextLegend.appendChild(item);
      }
    }

    const percent = Math.round((totalUsed / total) * 100);
    if (contextVizUsed) contextVizUsed.textContent = t("context.used", { pct: percent });
    if (contextVizTotal) {
      contextVizTotal.textContent = `${formatTokens(totalUsed)} / ${formatTokens(total)}`;
    }
  }

  // Portal the popover to <body> so it escapes the header's stacking context
  // (z-index: 10). Without this, the file preview panel covers it. We move
  // the element once at setup and re-position it with fixed coordinates on
  // every open so it tracks the button even if the header layout shifts.
  if (contextViz.parentElement && contextViz.parentElement !== document.body) {
    document.body.appendChild(contextViz);
  }

  function positionAndShow() {
    if (!tokenUsageEl || !contextViz) return;
    const rect = tokenUsageEl.getBoundingClientRect();
    contextViz.style.position = "fixed";
    contextViz.style.top = `${rect.bottom + 8}px`;
    // Right-align the popover's right edge with the button's right edge.
    contextViz.style.right = `${window.innerWidth - rect.right}px`;
    contextViz.style.left = "auto";
    contextViz.classList.remove("hidden");
  }

  function hide() {
    if (!contextViz) return;
    contextViz.classList.add("hidden");
  }

  tokenUsageEl.addEventListener("click", (event) => {
    event.stopPropagation();
    const lastUsage = getUsage?.();
    const contextWindowSize =
      Number(getContextWindowSize?.()) || Number(lastUsage?.contextWindow) || 0;
    if (!lastUsage || contextWindowSize <= 0) return;
    if (contextViz.classList.contains("hidden")) {
      updateContextViz();
      positionAndShow();
    } else {
      hide();
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    if (!contextViz.contains(event.target) && event.target !== tokenUsageEl) hide();
  });

  return { update: updateContextViz, hide };
}

/** @param {unknown} value */
export function formatTokens(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
