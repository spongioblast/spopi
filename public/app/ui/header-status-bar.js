// ABOUTME: Owns the session-aggregate cost row in the header and publishes
// ABOUTME: token totals for the combined context pill. Completely separate from
// ABOUTME: the current-context (lastUsage) lifecycle so a successful Compact can
// ABOUTME: invalidate stale context without fabricating usage.

/**
 * @param {number} amount
 */
function formatCost(amount) {
  return Number.isFinite(amount) ? amount.toFixed(4) : "0.0000";
}

/**
 * @param {unknown} value
 */
function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteToken(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} prev
 * @param {unknown} next
 */
function sum(prev, next) {
  return finiteAmount(prev) + finiteAmount(next);
}

/**
 * Build a header status bar that renders session-aggregate cost
 * (sourced only from `hydrateSessionStats` and post-hydration `applyLiveUsage`)
 * and notifies the caller of token totals for the combined usage pill.
 *
 * Aggregate totals are intentionally not derived from `lastUsage`/history
 * replay: repeated mirror syncs and history rendering must never increment
 * them. Only the authoritative `get_session_stats` hydration and new live
 * assistant completions for the same active session contribute.
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
  let hasHydrated = false;

  function renderAggregate() {
    if (totals.cost > 0) {
      costEl.textContent = translate("usage.costSub", { amount: `$${formatCost(totals.cost)}` });
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
    hasHydrated = false;
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
    hasHydrated = true;
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

  /**
   * @param {{
   *   input?: unknown,
   *   output?: unknown,
   *   cacheRead?: unknown,
   *   cacheWrite?: unknown,
   *   cost?: { total?: unknown } | null,
   * }} [usage]
   * @param {{ sessionFile?: string | null }} [context]
   */
  function applyLiveUsage(
    { input, output, cacheRead, cacheWrite, cost } = {},
    { sessionFile } = {},
  ) {
    // Live usage is accepted only after the active session identity has been
    // authoritatively hydrated. Unknown identities and the reset-to-hydration
    // race are deliberately dropped; the caller requests a fresh hydration
    // instead of risking cross-session or replay double-counting.
    if (!sessionFile || !hasHydrated || sessionFile !== hydratedSessionFile) return false;
    totals.input = sum(totals.input, finiteAmount(input));
    totals.output = sum(totals.output, finiteAmount(output));
    totals.cacheRead = sum(totals.cacheRead, finiteAmount(cacheRead));
    totals.cacheWrite = sum(totals.cacheWrite, finiteAmount(cacheWrite));
    totals.cost = sum(totals.cost, finiteAmount(cost?.total));
    renderAggregate();
    return true;
  }

  return { applyLiveUsage, hydrateSessionStats, reset };
}
