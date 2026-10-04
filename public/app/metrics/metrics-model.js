// ABOUTME: Folds pi runtime events and vLLM /metrics scrapes into one snapshot with session totals.
// ABOUTME: Composes the turn tracker, scrape parser, and prompt views. This file has no DOM or fetch.

import { COMPACTION_STALE_MS, compactionView, promptView } from "./metrics-prompt-view.js";
import { createTurnTracker, PROMPT_LOG_LIMIT } from "./metrics-turn-tracker.js";
import { deriveServerRates, EMPTY_RATES, parseVllmMetrics } from "./vllm-metrics.js";

export { cacheSharePct } from "./metrics-prompt-view.js";
export { describeToolArgs, summarizeToolArgs } from "./metrics-tool-args.js";
export { deriveServerRates, parseVllmMetrics } from "./vllm-metrics.js";

/**
 * @typedef {import("./vllm-metrics.js").VllmServerSample} VllmServerSample
 * @typedef {import("./vllm-metrics.js").ServerRates} ServerRates
 * @typedef {import("./metrics-turn-tracker.js").MetricsUsage} MetricsUsage
 * @typedef {import("./metrics-turn-tracker.js").MetricsToolEntry} MetricsToolEntry
 * @typedef {import("./metrics-turn-tracker.js").MetricsTurn} MetricsTurn
 * @typedef {import("./metrics-prompt-view.js").MetricsPromptView} MetricsPromptView
 * @typedef {import("./metrics-prompt-view.js").MetricsCompactionView} MetricsCompactionView
 *
 * @typedef {{
 *   ok: boolean | null,
 *   lastOkAt: number,
 *   error: string,
 *   latencyMs: number,
 *   scrapes: number,
 *   failures: number,
 * }} MetricsHealth
 *
 * @typedef {{
 *   kind: "prompt",
 *   at: number,
 *   prompt: MetricsPromptView,
 *   compaction?: undefined,
 * } | {
 *   kind: "compaction",
 *   at: number,
 *   compaction: MetricsCompactionView,
 *   prompt?: undefined,
 * }} MetricsLogEntry
 *
 * @typedef {{
 *   now?: () => number,
 *   historyLimit?: number,
 * }} CreateMetricsModelOptions
 *
 * @typedef {{
 *   at?: number,
 *   latencyMs?: number,
 * }} ServerScrapeOptions
 *
 * @typedef {{
 *   onRuntimeEvent: (event: unknown, at?: number) => void,
 *   recordServerScrape: (text: unknown, options?: ServerScrapeOptions) => {
 *     at: number,
 *     sample: VllmServerSample,
 *     latencyMs: number,
 *   },
 *   recordServerFailure: (error: unknown, options?: ServerScrapeOptions) => void,
 *   reset: () => void,
 *   setModelInfo: (next: unknown) => void,
 *   snapshot: (at?: number) => MetricsSnapshot,
 * }} MetricsModelApi
 *
 * @typedef {{
 *   active: boolean,
 *   phase: string,
 *   prompt: MetricsPromptView | null,
 *   promptLog: MetricsPromptView[],
 *   compactions: MetricsCompactionView[],
 *   log: MetricsLogEntry[],
 *   avgDecodeTps: number,
 *   turn: {
 *     elapsedMs: number,
 *     phase: string,
 *     textChars: number,
 *     thinkingChars: number,
 *     deltas: number,
 *     usage: MetricsUsage | null,
 *     outputTokens: number,
 *     reasoningTokens: number,
 *     inputTokens: number,
 *     cacheReadTokens: number,
 *     cost: number,
 *     liveTps: number,
 *     turnTps: number,
 *     compactions: number,
 *     pendingCompaction: boolean,
 *     retries: number,
 *     lastExtensionError: unknown,
 *   },
 *   model: Record<string, unknown> | null,
 *   tools: Array<MetricsToolEntry & { durationMs: number }>,
 *   runningToolCount: number,
 *   server: VllmServerSample | null,
 *   rates: ServerRates,
 *   health: MetricsHealth,
 *   session: {
 *     input: number,
 *     output: number,
 *     reasoning: number,
 *     cacheRead: number,
 *     cost: number,
 *     turns: number,
 *     tokens: number,
 *   },
 * }} MetricsSnapshot
 */

const TOOL_HISTORY_LIMIT = 14;
const LOG_MERGE_LIMIT = 24;
const PROMPT_AVG_WINDOW = 5;

/**
 * @param {CreateMetricsModelOptions} [options]
 * @returns {MetricsModelApi}
 */
export function createMetricsModel({
  now = () => Date.now(),
  historyLimit = TOOL_HISTORY_LIMIT,
} = {}) {
  const tracker = createTurnTracker({ now, historyLimit });
  /** @type {VllmServerSample | null} */
  let server = null;
  /** @type {VllmServerSample | null} */
  let lastSample = null;
  let lastSampleAt = 0;
  /** @type {ServerRates} */
  let rates = { ...EMPTY_RATES };
  /** @type {MetricsHealth} */
  let health = { ok: null, lastOkAt: 0, error: "", latencyMs: 0, scrapes: 0, failures: 0 };
  /** @type {Record<string, unknown> | null} */
  let modelInfo = null;

  /**
   * @param {unknown} text
   * @param {ServerScrapeOptions} [options]
   * @returns {{ at: number, sample: VllmServerSample, latencyMs: number }}
   */
  function recordServerScrape(text, { at = now(), latencyMs = 0 } = {}) {
    const parsed = parseVllmMetrics(text);
    // Rates compare against the immediately preceding scrape only; comparing a
    // one-interval delta over a two-interval window would halve every number.
    rates = lastSample
      ? deriveServerRates(lastSample, parsed, at - lastSampleAt)
      : { ...EMPTY_RATES };
    lastSample = parsed;
    lastSampleAt = at;
    server = parsed;
    if (rates.deltas) tracker.foldEngineDeltas(rates.deltas, parsed.kvCachePct, at);
    health = {
      ...health,
      ok: true,
      lastOkAt: at,
      error: "",
      latencyMs: Math.max(0, Math.round(latencyMs)),
      scrapes: health.scrapes + 1,
    };
    return { at, sample: parsed, latencyMs: Math.max(0, Math.round(latencyMs)) };
  }

  /**
   * @param {unknown} error
   * @param {ServerScrapeOptions} [options]
   */
  function recordServerFailure(error, { at: _at = now(), latencyMs = 0 } = {}) {
    rates = { ...EMPTY_RATES };
    health = {
      ...health,
      ok: false,
      error: String(error || "unreachable").slice(0, 180),
      latencyMs: Math.max(0, Math.round(latencyMs)),
      failures: health.failures + 1,
    };
  }

  /**
   * @param {unknown} next
   */
  function setModelInfo(next) {
    modelInfo =
      next && typeof next === "object"
        ? { .../** @type {Record<string, unknown>} */ (next) }
        : null;
  }

  function reset() {
    tracker.reset();
    rates = { ...EMPTY_RATES };
  }

  /**
   * @param {number} [at]
   * @returns {MetricsSnapshot}
   */
  function snapshot(at = now()) {
    const { turn, lastTurn, tools, prompts, compactionLog, session } = tracker.read();
    const active = Boolean(turn && !turn.finishedAt);
    const activeTurn = turn || null;
    const usage = activeTurn?.usage || null;
    const elapsedMs = activeTurn
      ? Math.max(0, (active ? at : activeTurn.finishedAt) - activeTurn.startedAt)
      : 0;
    const runningTools = tools.filter((entry) => entry.status === "running");
    const source = activeTurn || lastTurn;
    const prompt = promptView(source, at, active);
    /** @type {(MetricsTurn | null)[]} */
    const logSources = active ? [activeTurn, ...prompts] : [lastTurn, ...prompts];
    const promptLog = logSources
      .filter(/** @returns {item is MetricsTurn} */ (item) => Boolean(item))
      .slice(0, PROMPT_LOG_LIMIT)
      .map((item, index) => {
        const view = promptView(item, at, active && index === 0);
        return /** @type {MetricsPromptView} */ (view);
      });
    /** @type {MetricsTurn[]} */
    const sources = [];
    const seenSources = new Set();
    for (const item of [lastTurn, ...(turn && turn !== lastTurn ? [turn] : []), ...prompts]) {
      if (!item || seenSources.has(item.id)) continue;
      seenSources.add(item.id);
      sources.push(item);
    }
    sources.sort((left, right) => left.startedAt - right.startedAt);
    const compactions = compactionLog.map((entry) => compactionView(entry, sources, at));
    /** @type {MetricsLogEntry[]} */
    const log = [
      ...promptLog.map(
        (item) =>
          /** @type {MetricsLogEntry} */ ({ kind: "prompt", at: item.startedAt, prompt: item }),
      ),
      ...compactions.map(
        (item) =>
          /** @type {MetricsLogEntry} */ ({
            kind: "compaction",
            at: item.startedAt,
            compaction: item,
          }),
      ),
    ]
      .sort((left, right) => right.at - left.at)
      .slice(0, LOG_MERGE_LIMIT);
    const scored = promptLog
      .filter((item) => !item.active && item.decodeTps > 0)
      .slice(0, PROMPT_AVG_WINDOW);
    const avgDecodeTps = scored.length
      ? scored.reduce((total, item) => total + item.decodeTps, 0) / scored.length
      : 0;
    return {
      active,
      phase: active && activeTurn ? activeTurn.phase : "idle",
      prompt,
      promptLog,
      compactions,
      log,
      avgDecodeTps,
      turn: {
        elapsedMs,
        phase: source?.phase || "idle",
        textChars: source?.textChars || 0,
        thinkingChars: source?.thinkingChars || 0,
        deltas: source?.deltas || 0,
        usage,
        outputTokens: Number(usage?.output) || 0,
        reasoningTokens: Number(usage?.reasoning) || 0,
        inputTokens: Number(usage?.input) || 0,
        cacheReadTokens: Number(usage?.cacheRead) || 0,
        cost: Number(usage?.cost?.total) || 0,
        liveTps: tracker.liveTps(),
        turnTps: elapsedMs > 400 ? (Number(usage?.output) || 0) / (elapsedMs / 1000) : 0,
        compactions: source?.compactions || 0,
        pendingCompaction: compactionLog.some(
          (entry) => entry.status === "running" && at - entry.startedAt <= COMPACTION_STALE_MS,
        ),
        retries: source?.retries || 0,
        lastExtensionError: source?.lastExtensionError || "",
      },
      model: modelInfo,
      tools: tools.map((entry) => ({
        ...entry,
        durationMs: entry.finishedAt
          ? Math.max(0, entry.finishedAt - entry.startedAt)
          : Math.max(0, at - entry.startedAt),
      })),
      runningToolCount: runningTools.length,
      server,
      rates,
      health,
      session: { ...session },
    };
  }

  return {
    onRuntimeEvent: tracker.onRuntimeEvent,
    recordServerScrape,
    recordServerFailure,
    reset,
    setModelInfo,
    snapshot,
  };
}
