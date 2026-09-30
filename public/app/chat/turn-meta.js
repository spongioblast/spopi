// ABOUTME: Restore/Fork on user turns and Tier 0 timing chips on assistant turns.
// ABOUTME: Some turns hide that row when there is nothing to show.

import { forkMessage } from "./message-actions.js";

// Restore is a workspace-history command. Fork is Pi's own `fork` (a new
// session), raised as the same message.fork action the bubble's branch icon uses.
export function userTurnActions() {
  return [
    { id: "restore", command: "/undo" },
    { id: "fork", type: "message.fork" },
  ];
}

/**
 * @param {{
 *   ttftMs?: number,
 *   cacheHit?: boolean,
 *   outputTokens?: number,
 *   tokensPerSec?: number,
 *   model?: string,
 * }} [snapshot]
 */
export function assistantTurnMeta({ ttftMs, cacheHit, outputTokens, tokensPerSec, model } = {}) {
  const ttft = typeof ttftMs === "number" && Number.isFinite(ttftMs) ? ttftMs : null;
  const out =
    typeof outputTokens === "number" && Number.isFinite(outputTokens) ? outputTokens : null;
  const tps =
    typeof tokensPerSec === "number" && Number.isFinite(tokensPerSec) && tokensPerSec > 0
      ? tokensPerSec
      : null;
  return {
    ttft: ttft !== null ? `${Math.round(ttft)} ms` : "—",
    cache: cacheHit === true ? "cache hit" : cacheHit === false ? "cache miss" : "cache: —",
    out: out !== null ? `${out} out` : "— out",
    tps: tps !== null ? `${tps.toFixed(1)} t/s` : "— t/s",
    model: model || "—",
  };
}

/** @param {number} chatWidth */
export function shouldHideTurnMeta(chatWidth) {
  return Number(chatWidth) > 0 && Number(chatWidth) < 380;
}

/**
 * @param {HTMLElement | null | undefined} messageEl
 * @param {{
 *   ttftMs?: number,
 *   cacheHit?: boolean,
 *   outputTokens?: number,
 *   tokensPerSec?: number,
 *   model?: string,
 * } | null | undefined} snapshot
 */
export function appendAssistantTurnMeta(messageEl, snapshot) {
  if (!messageEl) return null;
  const meta = assistantTurnMeta(snapshot ?? {});
  const row = document.createElement("div");
  row.className = "turn-meta";
  const dot = document.createElement("span");
  dot.className = "cache-dot";
  row.append(
    dot,
    document.createTextNode(
      ` ${meta.ttft} · ${meta.cache} · ${meta.out} · ${meta.tps} · ${meta.model}`,
    ),
  );
  messageEl.appendChild(row);
  return row;
}

/**
 * @param {HTMLElement | null | undefined} messageEl
 * @param {(command?: string) => void} [onAction]
 */
export function appendUserTurnActions(messageEl, onAction) {
  if (!messageEl) return null;
  const row = document.createElement("div");
  row.className = "turn-meta";
  for (const action of userTurnActions()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.id;
    button.addEventListener("click", () => {
      if (action.type === "message.fork") {
        forkMessage({ entryId: messageEl.dataset?.entryId || null, text: "", messageEl });
        return;
      }
      onAction?.(action.command);
    });
    row.appendChild(button);
  }
  messageEl.appendChild(row);
  return row;
}
