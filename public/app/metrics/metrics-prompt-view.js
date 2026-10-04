// ABOUTME: Shapes one recorded prompt or compaction into the plain view rows the Cockpit renders.
// ABOUTME: Pure reads of tracker records; the records themselves are owned by the turn tracker.

import { ratio } from "./vllm-metrics.js";

/**
 * @typedef {import("./metrics-turn-tracker.js").EngineStats} EngineStats
 * @typedef {import("./metrics-turn-tracker.js").MetricsTurn} MetricsTurn
 * @typedef {import("./metrics-turn-tracker.js").MetricsToolEntry} MetricsToolEntry
 * @typedef {import("./metrics-turn-tracker.js").MetricsCompactionEntry} MetricsCompactionEntry
 *
 * @typedef {{
 *   decodeTps: number,
 *   prefillTps: number,
 *   meanItlMs: number,
 *   meanTtftMs: number,
 *   meanQueueMs: number,
 *   meanPrefillMs: number,
 *   specAcceptPct: number,
 *   tokensPerStep: number,
 *   genTokens: number,
 *   kvPeakPct: number,
 * }} EngineView
 *
 * @typedef {{
 *   out: boolean,
 *   in: boolean,
 *   cached: boolean,
 *   think: boolean,
 * }} PromptEstimatedFlags
 *
 * @typedef {{
 *   id: number,
 *   startedAt: number,
 *   finishedAt: number,
 *   active: boolean,
 *   phase: string,
 *   durationMs: number,
 *   genMs: number,
 *   inputTokens: number,
 *   cacheReadTokens: number,
 *   promptTotalTokens: number,
 *   cacheSharePct: number,
 *   outputTokens: number,
 *   reasoningTokens: number,
 *   cost: number,
 *   estimated: PromptEstimatedFlags,
 *   textChars: number,
 *   thinkingChars: number,
 *   deltas: number,
 *   compactions: number,
 *   retries: number,
 *   clientTps: number,
 *   engine: EngineView | null,
 *   decodeTps: number,
 *   callOutputs: number[],
 *   tools: Array<MetricsToolEntry & { durationMs: number }>,
 *   toolCount: number,
 * }} MetricsPromptView
 *
 * @typedef {{
 *   id: number,
 *   startedAt: number,
 *   finishedAt: number,
 *   status: string,
 *   reason: string,
 *   before: number,
 *   after: number,
 *   afterAt: number,
 *   summaryTokens: number,
 *   error: string,
 *   turnId: number,
 *   durationMs: number,
 *   stale: boolean,
 *   saved: number,
 * }} MetricsCompactionView
 */

/** Tool rows shown under one prompt: the newest ones; the rest are counted, not dropped silently. */
const PROMPT_TOOLS_LIMIT = 40;
/* A compaction that never saw its `compaction_end` (event lost, session reloaded
   mid-summariser) must not pulse forever, so it is flagged rather than trusted. */
export const COMPACTION_STALE_MS = 120_000;

/**
 * Pi `usage.input` excludes cached tokens; share is cache / (input + cache).
 *
 * @param {unknown} [inputTokens]
 * @param {unknown} [cacheReadTokens]
 * @returns {number}
 */
export function cacheSharePct(inputTokens = 0, cacheReadTokens = 0) {
  const input = Number(inputTokens) || 0;
  const cacheRead = Number(cacheReadTokens) || 0;
  const total = input + cacheRead;
  if (total <= 0 || cacheRead <= 0) return 0;
  return Math.min(100, Math.max(0, (cacheRead / total) * 100));
}

/**
 * @param {EngineStats | null | undefined} stats
 * @returns {EngineView | null}
 */
function engineView(stats) {
  if (!stats) return null;
  return {
    decodeTps: stats.decodeTime > 0.02 ? stats.genTokens / stats.decodeTime : 0,
    prefillTps: stats.prefillTime > 0.02 ? stats.promptCompute / stats.prefillTime : 0,
    meanItlMs:
      stats.decodeTime > 0.02 && stats.genTokens > 0
        ? (stats.decodeTime / stats.genTokens) * 1000
        : 0,
    meanTtftMs: stats.ttftCount > 0 ? (stats.ttftSum / stats.ttftCount) * 1000 : 0,
    meanQueueMs: stats.queueCount > 0 ? (stats.queueTime / stats.queueCount) * 1000 : 0,
    meanPrefillMs: stats.prefillCount > 0 ? (stats.prefillTime / stats.prefillCount) * 1000 : 0,
    specAcceptPct: ratio(stats.accepted, stats.draftTokens) * 100,
    tokensPerStep: ratio(stats.accepted, stats.drafts) + 1,
    genTokens: stats.genTokens,
    kvPeakPct: stats.kvPeak,
  };
}

/**
 * One prompt's stats. Rates are cumulative since the prompt began, so they
 * update continuously while it runs and equal the final result once it ends.
 *
 * @param {MetricsTurn | null | undefined} source
 * @param {number} at
 * @param {boolean} isActive
 * @returns {MetricsPromptView | null}
 */
export function promptView(source, at, isActive) {
  if (!source) return null;
  const usage = source.usage || null;
  const end = isActive ? at : source.finishedAt || source.closedAt || at;
  const genMs =
    source.lastDeltaAt > source.firstDeltaAt ? source.lastDeltaAt - source.firstDeltaAt : 0;
  const engine = engineView(source.engine);
  // pi's RPC sends usage only on `message_end`, so while a prompt is running
  // the counts come from the engine's counters instead (real tokens, counted
  // server-side) and are flagged as such. `usage` replaces them when it lands.
  const stats = source.engine;
  const output = Number(usage?.output) || stats?.genTokens || 0;
  const input = Number(usage?.input) || stats?.promptTokens || 0;
  const cacheRead = Number(usage?.cacheRead) || stats?.promptCached || 0;
  // Thinking tokens cannot be split from the engine side, so while streaming
  // they are estimated from the thinking deltas pi does send.
  const reasoning =
    Number(usage?.reasoning) || (stats ? Math.round((source.thinkingChars || 0) / 4) : 0);
  const estimated = {
    out: !usage && Boolean(stats?.genTokens),
    in: !usage && Boolean(stats?.promptTokens),
    cached: !usage && Boolean(stats?.promptCached),
    think: !usage && Boolean(source.thinkingChars),
  };
  const clientTps = genMs > 400 ? output / (genMs / 1000) : 0;
  return {
    id: source.id || 0,
    startedAt: source.startedAt,
    finishedAt: end,
    active: isActive,
    phase: source.phase || "idle",
    durationMs: Math.max(0, end - source.startedAt),
    genMs,
    inputTokens: input,
    cacheReadTokens: cacheRead,
    promptTotalTokens: input + cacheRead,
    cacheSharePct: cacheSharePct(input, cacheRead),
    outputTokens: output,
    reasoningTokens: reasoning,
    cost: Number(usage?.cost?.total) || 0,
    // Which of the counts above are engine-derived rather than pi's own usage.
    estimated,
    textChars: source.textChars || 0,
    thinkingChars: source.thinkingChars || 0,
    deltas: source.deltas || 0,
    compactions: source.compactions || 0,
    retries: source.retries || 0,
    clientTps,
    engine,
    // Engine truth when the overlay saw the turn, else the client estimate.
    decodeTps: engine?.decodeTps || clientTps,
    callOutputs: [...(source.callOutputs || [])],
    tools: (source.tools || []).slice(-PROMPT_TOOLS_LIMIT).map((tool) => ({
      ...tool,
      durationMs: tool.finishedAt
        ? Math.max(0, tool.finishedAt - tool.startedAt)
        : Math.max(0, at - tool.startedAt),
    })),
    toolCount: (source.tools || []).length,
  };
}

/**
 * A compaction row: how big the context was, how big it became, and what the
 * summary cost. The `after` size is never guessed — pi only reports
 * `tokensBefore`, so the new size is read off the first request that actually
 * ran afterwards: that turn's next `message_end` usage when the compaction
 * happened mid-turn, or the next prompt's when it happened while idle.
 *
 * @param {MetricsCompactionEntry} entry
 * @param {MetricsTurn[]} sources
 * @param {number} at
 * @returns {MetricsCompactionView}
 */
export function compactionView(entry, sources, at) {
  const end = entry.finishedAt || at;
  // Only a compaction that actually succeeded rewrote the context; a failed or
  // aborted one leaves the size untouched, so the next request proves nothing
  // about it and must not be shown as the "after" number.
  const measurable = entry.status === "ok";
  let after = 0;
  let afterAt = 0;
  for (const source of measurable ? sources : []) {
    if (source.id === entry.turnId && entry.finishedAt) {
      if (source.usage && Number(source.lastUsageAt) >= entry.finishedAt) {
        after = Number(source.usage.input) || 0;
        afterAt = Number(source.lastUsageAt) || 0;
        break;
      }
      continue;
    }
    if (entry.finishedAt && source.startedAt >= entry.finishedAt) {
      const view = promptView(source, at, false);
      if (view && view.inputTokens > 0) {
        after = view.inputTokens;
        afterAt = view.startedAt;
        break;
      }
    }
  }
  return {
    id: entry.id,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    status: entry.status,
    reason: entry.reason,
    before: entry.before,
    after,
    afterAt,
    summaryTokens: entry.summaryTokens,
    error: entry.error,
    turnId: entry.turnId,
    durationMs: Math.max(0, end - entry.startedAt),
    stale: entry.status === "running" && at - entry.startedAt > COMPACTION_STALE_MS,
    saved: after > 0 && entry.before > 0 ? Math.max(0, entry.before - after) : 0,
  };
}
