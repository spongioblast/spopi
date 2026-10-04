// ABOUTME: Owns the session-aggregate cost row in the header and publishes token totals.
// ABOUTME: Totals come only from Pi's get_session_stats, never from the current context.

import { formatUsd } from "./formatters.js";

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteToken(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build a header status bar that renders the session-aggregate cost and
 * notifies the caller of token totals for the combined usage pill.
 *
 * @param {{
 *   sessionCostEl?: HTMLElement | null,
 *   t?: (key: string, params?: Record<string, string>) => string,
 *   onTotalsChange?: (totals: {
 *     input: number,
 *     output: number,
 *     cacheRead: number,
 *     cacheWrite: number,
 *     cost: number,
 *   }) => void,
 * }} [deps]
 */
export function createHeaderStatusBar({ sessionCostEl, t, onTotalsChange } = {}) {
  if (!(sessionCostEl instanceof HTMLElement) || typeof t !== "function") {
    throw new Error("header status bar needs a cost element");
  }
  const costEl = sessionCostEl;
  const translate = t;
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  /** @type {string | null} */
  let hydratedSessionFile = null;

  function renderAggregate() {
    if (totals.cost > 0) {
      costEl.textContent = translate("usage.costSub", { amount: formatUsd(totals.cost, 4) });
      costEl.classList.add("visible");
    } else {
      costEl.replaceChildren();
      costEl.classList.remove("visible");
    }
    onTotalsChange?.({ ...totals });
  }

  function reset() {
    totals.input = 0;
    totals.output = 0;
    totals.cacheRead = 0;
    totals.cacheWrite = 0;
    totals.cost = 0;
    hydratedSessionFile = null;
    renderAggregate();
  }

  /**
   * @param {{
   *   sessionFile?: string | null,
   *   tokens?: {
   *     input?: number,
   *     output?: number,
   *     cacheRead?: number,
   *     cacheWrite?: number,
   *   } | null,
   *   cost?: { total?: number } | null,
   * }} [stats]
   */
  function hydrateSessionStats({ sessionFile, tokens, cost } = {}) {
    // The authoritative aggregate. Re-hydrating the same session replaces
    // (never accumulates) so repeated mirror syncs cannot double-count.
    // A missing identity is not safe to apply because it could belong to a
    // previous session after an in-place switch.
    if (!sessionFile) return false;
    if (hydratedSessionFile && sessionFile !== hydratedSessionFile) return false;
    hydratedSessionFile = sessionFile;
    // `tokens: null` is the authoritative zero state for a session with no
    // assistant usage yet; it must not leave stale totals on screen.
    const input = finiteToken(tokens?.input);
    const output = finiteToken(tokens?.output);
    const cacheRead = finiteToken(tokens?.cacheRead);
    const cacheWrite = finiteToken(tokens?.cacheWrite);
    const total = finiteToken(cost?.total);
    totals.input = input == null ? 0 : Math.max(0, input);
    totals.output = output == null ? 0 : Math.max(0, output);
    totals.cacheRead = cacheRead == null ? 0 : Math.max(0, cacheRead);
    totals.cacheWrite = cacheWrite == null ? 0 : Math.max(0, cacheWrite);
    totals.cost = total == null ? 0 : Math.max(0, total);
    renderAggregate();
    return true;
  }

  return { hydrateSessionStats, reset };
}
