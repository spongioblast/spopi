// ABOUTME: Session cost pill and header token totals.
// ABOUTME: Totals come from get_session_stats, not from walking the transcript.

import { createHeaderStatusBar } from "../ui/header-status-bar.js";

/**
 * @typedef {{ id?: string, projectPath?: string | null, filePath?: string | null }} CostBarSession
 * @typedef {{ sessionId?: string }} CostBarTarget
 * @typedef {{
 *   request: (payload: { type: string }, target?: CostBarTarget | null) => Promise<unknown>,
 * }} CostBarRuntime
 */

/**
 * @param {object} options
 * @param {Element | null | undefined} options.sessionCostEl
 * @param {(key: string, params?: Record<string, string>) => string} options.t
 * @param {(totals: {
 *   input: number,
 *   output: number,
 *   cacheRead: number,
 *   cacheWrite: number,
 *   cost: number,
 * }) => void} [options.onTotalsChange]
 * @param {CostBarRuntime} options.runtime
 * @param {() => CostBarTarget} options.getTarget
 * @param {() => CostBarSession[]} options.getSessions
 * @param {() => string | null | undefined} options.getCwd
 */
export function mountSessionCostBar({
  sessionCostEl,
  t,
  onTotalsChange,
  runtime,
  getTarget,
  getSessions,
  getCwd,
}) {
  const headerStatusBar = sessionCostEl
    ? createHeaderStatusBar({
        sessionCostEl: /** @type {HTMLElement} */ (/** @type {unknown} */ (sessionCostEl)),
        t,
        onTotalsChange,
      })
    : null;
  let sessionTotalCost = 0;
  let statsHydrationGeneration = 0;

  function activeSessionFile() {
    const sessions = getSessions();
    const target = getTarget();
    return (
      sessions.find((session) => session.id === target.sessionId)?.filePath ??
      sessions.find((session) => session.projectPath === getCwd())?.filePath ??
      null
    );
  }

  async function hydrateHeaderSessionStats() {
    if (!headerStatusBar) return;
    const generation = ++statsHydrationGeneration;
    const target = getTarget();
    try {
      const frame = await runtime.request({ type: "get_session_stats" }, target);
      // runtime.request resolves with the full runtime_response frame; the pi
      // result lives in frame.response.
      const envelope =
        frame && typeof frame === "object" ? /** @type {Record<string, unknown>} */ (frame) : null;
      const resultRaw = envelope?.response ?? frame;
      const result =
        resultRaw && typeof resultRaw === "object"
          ? /** @type {{
              success?: boolean,
              data?: {
                sessionFile?: string,
                tokens?: {
                  input?: number,
                  output?: number,
                  cacheRead?: number,
                  cacheWrite?: number,
                } | null,
                cost?: { total?: number } | null,
              },
            }} */ (resultRaw)
          : null;
      if (!result?.success || !result?.data) return;
      if (generation !== statsHydrationGeneration) return;
      if (!result.data.sessionFile) return;
      const activeSessionFilePath = activeSessionFile();
      if (activeSessionFilePath && result.data.sessionFile !== activeSessionFilePath) return;
      headerStatusBar.hydrateSessionStats({
        sessionFile: result.data.sessionFile,
        tokens: result.data.tokens,
        cost: result.data.cost,
      });
    } catch {
      // Aggregate hydration is best-effort; the current-context path still works.
    }
  }

  /** @param {unknown} messages */
  function computeTotalCostFromMessages(messages) {
    if (!Array.isArray(messages)) return 0;
    let total = 0;
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const usage = /** @type {{ usage?: { cost?: { total?: unknown } } }} */ (msg).usage;
      if (usage?.cost?.total) total += Number(usage.cost.total) || 0;
    }
    return total;
  }

  /** @param {number} cost */
  function setSessionCost(cost) {
    sessionTotalCost = cost;
    if (!sessionCostEl) return;
    if (!cost || cost <= 0) {
      sessionCostEl.classList.remove("visible");
      sessionCostEl.textContent = "";
      return;
    }
    sessionCostEl.classList.add("visible");
    sessionCostEl.textContent = `$${cost.toFixed(4)}`;
    if ("title" in sessionCostEl) {
      /** @type {{ title: string }} */ (sessionCostEl).title = `Session cost: $${cost.toFixed(6)}`;
    }
  }

  return {
    headerStatusBar,
    activeSessionFile,
    hydrateHeaderSessionStats,
    computeTotalCostFromMessages,
    setSessionCost,
    get sessionTotalCost() {
      return sessionTotalCost;
    },
  };
}
