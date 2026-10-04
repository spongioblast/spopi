// ABOUTME: Folds Pi runtime events into prompts, tool rows, compactions, and session token totals.
// ABOUTME: A prompt spans every model call until agent_end. No DOM, no fetch, no snapshot shaping.

import { describeToolArgs, summarizeToolArgs } from "./metrics-tool-args.js";

/**
 * @typedef {import("./vllm-metrics.js").ServerRateDeltas} ServerRateDeltas
 *
 * @typedef {{
 *   input?: number,
 *   output?: number,
 *   reasoning?: number,
 *   cacheRead?: number,
 *   cost?: { total?: number } | null,
 * }} MetricsUsage
 *
 * @typedef {{
 *   genTokens: number,
 *   promptTokens: number,
 *   promptCached: number,
 *   decodeTime: number,
 *   promptCompute: number,
 *   prefillTime: number,
 *   ttftSum: number,
 *   ttftCount: number,
 *   queueTime: number,
 *   queueCount: number,
 *   prefillCount: number,
 *   drafts: number,
 *   draftTokens: number,
 *   accepted: number,
 *   kvPeak: number,
 * }} EngineStats
 *
 * @typedef {{
 *   id: string,
 *   toolName: string,
 *   label: string,
 *   title: string,
 *   startedAt: number,
 *   finishedAt: number,
 *   status: string,
 *   updates: number,
 *   outputChars: number,
 * }} MetricsToolEntry
 *
 * @typedef {{
 *   id: number,
 *   startedAt: number,
 *   finishedAt: number,
 *   closedAt: number,
 *   phase: string,
 *   textChars: number,
 *   thinkingChars: number,
 *   deltas: number,
 *   firstDeltaAt: number,
 *   lastDeltaAt: number,
 *   usage: MetricsUsage | null,
 *   lastUsageAt?: number,
 *   callOutputs: number[],
 *   compactions: number,
 *   retries: number,
 *   tools: MetricsToolEntry[],
 *   engine: EngineStats | null,
 *   credited?: boolean,
 *   lastExtensionError?: unknown,
 * }} MetricsTurn
 *
 * @typedef {{
 *   id: number,
 *   startedAt: number,
 *   finishedAt: number,
 *   reason: string,
 *   status: string,
 *   before: number,
 *   after: number,
 *   summaryTokens: number,
 *   error: string,
 *   turnId: number,
 * }} MetricsCompactionEntry
 *
 * @typedef {{ at: number, output: number }} TpsPoint
 *
 * @typedef {{
 *   input: number,
 *   output: number,
 *   reasoning: number,
 *   cacheRead: number,
 *   cost: number,
 *   turns: number,
 *   tokens: number,
 * }} MetricsSessionTotals
 *
 * @typedef {{
 *   type?: string,
 *   message?: {
 *     role?: string,
 *     usage?: MetricsUsage | null,
 *   },
 *   assistantMessageEvent?: {
 *     type?: string,
 *     delta?: unknown,
 *   },
 *   usage?: MetricsUsage | null,
 *   toolCallId?: string,
 *   parentToolCallId?: unknown,
 *   toolName?: string,
 *   args?: unknown,
 *   partialResult?: { content?: unknown },
 *   result?: unknown,
 *   isError?: boolean,
 *   reason?: unknown,
 *   errorMessage?: unknown,
 *   error?: unknown,
 *   aborted?: unknown,
 *   willRetry?: unknown,
 *   tokensBefore?: unknown,
 * }} MetricsRuntimeEvent
 *
 * @typedef {{
 *   turn: MetricsTurn | null,
 *   lastTurn: MetricsTurn | null,
 *   tools: MetricsToolEntry[],
 *   prompts: MetricsTurn[],
 *   compactionLog: MetricsCompactionEntry[],
 *   session: MetricsSessionTotals,
 * }} TurnTrackerState
 *
 * @typedef {{
 *   onRuntimeEvent: (event: unknown, at?: number) => void,
 *   foldEngineDeltas: (deltas: ServerRateDeltas, kvCachePct: number, at: number) => void,
 *   liveTps: () => number,
 *   reset: () => void,
 *   read: () => TurnTrackerState,
 * }} TurnTracker
 */

const TPS_WINDOW_MS = 3000;
/** Longest gap still folded into the live tokens/s estimate. */
const TPS_WINDOW_POINTS = 24;
/** How many prompts the scrollable log keeps, and how many feed the average. */
export const PROMPT_LOG_LIMIT = 12;
/* Compactions are rare and each one explains a slow prompt, so a short log of
   them is worth keeping; pi can also compact while idle (`/compact`). */
const COMPACTION_LOG_LIMIT = 8;
/**
 * A prompt still absorbs engine deltas for this long after it ended, so the
 * scrape that fires on `agent_end` (which the overlay runs right after closing
 * the turn) is credited to the prompt that earned those tokens. Bounded, so a
 * stale prompt cannot absorb traffic from a later request.
 */
const CLOSE_GRACE_MS = 5000;

/**
 * @param {unknown} content
 * @returns {number}
 */
function textLength(content) {
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    const item = /** @type {{ text?: unknown } | null | undefined} */ (block);
    if (typeof item?.text === "string") total += item.text.length;
  }
  return total;
}

/**
 * A prompt's usage across its model calls. Generated tokens and cost add up;
 * input and cache reads are the latest call's, because each call re-sends the
 * whole context and summing them would count the same tokens again.
 * @param {MetricsUsage | null} total
 * @param {MetricsUsage} call
 * @returns {MetricsUsage}
 */
function addCallUsage(total, call) {
  const cost = (Number(total?.cost?.total) || 0) + (Number(call.cost?.total) || 0);
  return {
    input: Number(call.input) || 0,
    cacheRead: Number(call.cacheRead) || 0,
    output: (Number(total?.output) || 0) + (Number(call.output) || 0),
    reasoning: (Number(total?.reasoning) || 0) + (Number(call.reasoning) || 0),
    cost: { total: cost },
  };
}

/**
 * @returns {EngineStats}
 */
function emptyEngine() {
  return {
    genTokens: 0,
    promptTokens: 0,
    promptCached: 0,
    decodeTime: 0,
    promptCompute: 0,
    prefillTime: 0,
    ttftSum: 0,
    ttftCount: 0,
    queueTime: 0,
    queueCount: 0,
    prefillCount: 0,
    drafts: 0,
    draftTokens: 0,
    accepted: 0,
    kvPeak: 0,
  };
}

/**
 * @param {{ now: () => number, historyLimit: number }} deps
 * @returns {TurnTracker}
 */
export function createTurnTracker({ now, historyLimit }) {
  /** @type {MetricsTurn | null} */
  let turn = null;
  /** @type {MetricsTurn | null} */
  let lastTurn = null;
  /** @type {MetricsToolEntry[]} */
  let tools = [];
  /** @type {MetricsTurn[]} */
  let prompts = [];
  /** @type {MetricsCompactionEntry[]} */
  let compactionLog = [];
  let compactionSeq = 0;
  let turnSeq = 0;
  /** @type {TpsPoint[]} */
  let tpsPoints = [];
  // `tokens` is the session's generated-token total: pi's usage where it
  // arrived, the engine's counter otherwise.
  /** @type {MetricsSessionTotals} */
  const session = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cost: 0, turns: 0, tokens: 0 };

  /**
   * @param {number} at
   */
  function startTurn(at) {
    // Close the previous prompt into the log before starting this one.
    if (turn) {
      if (!turn.closedAt) turn.closedAt = turn.finishedAt || at;
      creditTokens(turn);
      prompts = [turn, ...prompts].slice(0, PROMPT_LOG_LIMIT);
    }
    turnSeq += 1;
    turn = {
      id: turnSeq,
      startedAt: at,
      finishedAt: 0,
      closedAt: 0,
      phase: "working",
      textChars: 0,
      thinkingChars: 0,
      deltas: 0,
      firstDeltaAt: 0,
      lastDeltaAt: 0,
      usage: null,
      callOutputs: [],
      compactions: 0,
      retries: 0,
      tools: [],
      engine: null,
    };
    lastTurn = turn;
    tpsPoints = [];
    session.turns += 1;
  }

  /**
   * Credit a finished prompt's generated tokens to the session total exactly
   * once. pi's usage is preferred; prompts it never reported fall back to the
   * engine's own generated-token count.
   *
   * @param {MetricsTurn | null | undefined} source
   */
  function creditTokens(source) {
    if (!source || source.credited) return;
    source.credited = true;
    session.tokens += Number(source.usage?.output) || source.engine?.genTokens || 0;
  }

  /**
   * @param {MetricsToolEntry} entry
   */
  function pushTool(entry) {
    tools = [entry, ...tools].slice(0, historyLimit);
  }

  /**
   * @param {unknown} toolCallId
   * @returns {MetricsToolEntry | null}
   */
  function findTool(toolCallId) {
    return tools.find((entry) => entry.id === toolCallId) || null;
  }

  /**
   * @param {string} phase
   */
  function note(phase) {
    if (turn) turn.phase = phase;
  }

  /**
   * @param {unknown} event
   * @param {number} [at]
   */
  function onRuntimeEvent(event, at = now()) {
    if (!event || typeof event !== "object") return;
    const ev = /** @type {MetricsRuntimeEvent} */ (event);
    switch (ev.type) {
      case "agent_start":
        startTurn(at);
        break;
      // A Pi `turn_end` closes one model call, not the prompt; later calls and
      // tools in the same run still belong to it, so only the run's end finishes it.
      case "agent_end":
      case "agent_settled":
        if (!turn) startTurn(at);
        if (!turn) break;
        turn.finishedAt = at;
        turn.phase = "idle";
        creditTokens(turn);
        break;
      case "turn_start":
      case "turn_end":
        if (!turn) startTurn(at);
        break;
      case "message_start":
        if (!turn) startTurn(at);
        if (ev.message?.role === "assistant") note("thinking");
        break;
      case "message_update": {
        if (!turn) startTurn(at);
        if (!turn) break;
        const delta = ev.assistantMessageEvent || {};
        const chunk = typeof delta.delta === "string" ? delta.delta.length : 0;
        turn.deltas += 1;
        if (delta.type === "text_delta") {
          turn.textChars += chunk;
          note("streaming");
        } else if (delta.type === "thinking_delta") {
          turn.thinkingChars += chunk;
          note("thinking");
        } else if (delta.type === "toolcall_delta") {
          note("toolcall");
        } else if (delta.type === "toolcall_start") {
          note("toolcall");
        }
        // Generation window: first real token to last. Dividing by this (not by
        // turn wall time) keeps tool-call gaps out of client-side tokens/s.
        if (delta.type === "text_delta" || delta.type === "thinking_delta") {
          if (!turn.firstDeltaAt) turn.firstDeltaAt = at;
          turn.lastDeltaAt = at;
        }
        // pi omits usage while streaming; if a future build sends it again, the
        // only thing still needed from it is the streaming rate sample.
        const usage = ev.usage || null;
        if (usage) {
          tpsPoints = [...tpsPoints, { at, output: Number(usage.output) || 0 }].slice(
            -TPS_WINDOW_POINTS,
          );
        }
        break;
      }
      case "message_end": {
        if (ev.message?.role !== "assistant") return;
        if (!turn) startTurn(at);
        if (!turn) break;
        const usage = ev.message.usage || null;
        if (usage) {
          turn.usage = addCallUsage(turn.usage, usage);
          turn.callOutputs.push(Number(usage.output) || 0);
        }
        // When the size arrived matters: it decides whether a usage figure is
        // evidence about a compaction that happened mid-turn or about an older one.
        turn.lastUsageAt = usage ? at : turn.lastUsageAt || 0;
        note("working");
        if (usage) {
          session.input += Number(usage.input) || 0;
          session.output += Number(usage.output) || 0;
          session.reasoning += Number(usage.reasoning) || 0;
          session.cacheRead += Number(usage.cacheRead) || 0;
          session.cost += Number(usage.cost?.total) || 0;
        }
        break;
      }
      case "tool_execution_start": {
        if (typeof ev.parentToolCallId === "string" && ev.parentToolCallId) break;
        if (!turn) startTurn(at);
        const existing = findTool(ev.toolCallId);
        if (existing) {
          existing.startedAt = existing.startedAt || at;
          break;
        }
        const rawLabel = describeToolArgs(ev.toolName, ev.args);
        /** @type {MetricsToolEntry} */
        const entry = {
          id: /** @type {string} */ (ev.toolCallId || `tool-${tools.length}-${at}`),
          toolName: /** @type {string} */ (ev.toolName || "tool"),
          label: summarizeToolArgs(ev.toolName, ev.args),
          title: rawLabel,
          startedAt: at,
          finishedAt: 0,
          status: "running",
          updates: 0,
          outputChars: 0,
        };
        pushTool(entry);
        if (turn) turn.tools.push(entry);
        note("tool");
        break;
      }
      case "tool_execution_update": {
        const entry = findTool(ev.toolCallId);
        if (!entry) break;
        entry.updates += 1;
        entry.outputChars = Math.max(entry.outputChars, textLength(ev.partialResult?.content));
        note("tool");
        break;
      }
      case "tool_execution_end": {
        const entry = findTool(ev.toolCallId);
        if (entry) {
          entry.finishedAt = at;
          entry.status = ev.isError ? "error" : "ok";
          const resultContent = /** @type {{ content?: unknown } | null | undefined} */ (ev.result)
            ?.content;
          entry.outputChars = Math.max(entry.outputChars, textLength(resultContent));
        }
        note("working");
        break;
      }
      case "compaction_start": {
        // Only a turn that is still running can own a compaction; a `/compact`
        // between prompts belongs to no prompt, and its new size is then read off
        // the next prompt instead.
        const live = Boolean(turn && !turn.finishedAt);
        if (!turn) startTurn(at);
        // The prompt row's `compact N` marker only makes sense for a compaction
        // that happened inside that prompt; idle ones stay out of its counts.
        if (live && turn) turn.compactions += 1;
        compactionSeq += 1;
        compactionLog = [
          {
            id: compactionSeq,
            startedAt: at,
            finishedAt: 0,
            reason: typeof ev.reason === "string" ? ev.reason : "",
            status: "running",
            before: 0,
            after: 0,
            summaryTokens: 0,
            error: "",
            turnId: live && turn ? turn.id : 0,
          },
          ...compactionLog,
        ].slice(0, COMPACTION_LOG_LIMIT);
        note("compacting");
        break;
      }
      case "compaction_end": {
        // Mirror the app's own success test (app.js): pi reports failures through
        // error flags and a null result rather than a distinct event type.
        const entry = compactionLog.find((item) => item.status === "running");
        if (entry) {
          const result = /** @type {{ tokensBefore?: unknown, usage?: MetricsUsage | null }} */ (
            ev.result || {}
          );
          const error = String(ev.errorMessage || ev.error || "").slice(0, 200);
          entry.finishedAt = at;
          if (typeof ev.reason === "string") entry.reason = ev.reason;
          entry.before = Number(result.tokensBefore) || Number(ev.tokensBefore) || 0;
          entry.summaryTokens = Number(result.usage?.output) || 0;
          const failed =
            Boolean(error || ev.aborted) || ev.result === null || result.tokensBefore === 0;
          entry.error = error || (ev.aborted ? "aborted" : "");
          entry.status = failed
            ? ev.willRetry
              ? "retrying"
              : ev.aborted
                ? "aborted"
                : "error"
            : "ok";
        }
        note("working");
        break;
      }
      case "auto_retry_start":
        if (!turn) startTurn(at);
        if (!turn) break;
        turn.retries += 1;
        note("retrying");
        break;
      case "auto_retry_end":
        note("working");
        break;
      case "extension_error":
        if (turn) turn.lastExtensionError = ev.error || "Extension failed";
        break;
      default:
        break;
    }
  }

  /**
   * Fold one scrape window's engine deltas into the running prompt, so its
   * speed is a cumulative average over that prompt alone.
   *
   * @param {ServerRateDeltas} deltas
   * @param {number} kvCachePct
   * @param {number} at
   */
  function foldEngineDeltas(deltas, kvCachePct, at) {
    if (!turn || (turn.finishedAt && at - turn.finishedAt > CLOSE_GRACE_MS)) return;
    if (!turn.engine) turn.engine = emptyEngine();
    const stats = turn.engine;
    const accum = /** @type {Record<string, number>} */ (stats);
    for (const [key, value] of Object.entries(deltas)) accum[key] += value;
    // kvCachePct is already a percentage; do not scale it again.
    stats.kvPeak = Math.max(stats.kvPeak, kvCachePct || 0);
  }

  /**
   * Live tokens/s from pi's own streaming `usage.output`, over a short window.
   *
   * @returns {number}
   */
  function liveTps() {
    if (tpsPoints.length < 2) return 0;
    const newest = tpsPoints[tpsPoints.length - 1];
    let oldest = tpsPoints[0];
    for (const point of tpsPoints) {
      if (newest.at - point.at <= TPS_WINDOW_MS) {
        oldest = point;
        break;
      }
    }
    const dt = (newest.at - oldest.at) / 1000;
    if (!(dt > 0.15)) return 0;
    const gain = newest.output - oldest.output;
    return gain > 0 ? gain / dt : 0;
  }

  /** Session totals survive a reset; only the prompt history is dropped. */
  function reset() {
    turn = null;
    lastTurn = null;
    tools = [];
    prompts = [];
    compactionLog = [];
    compactionSeq = 0;
    turnSeq = 0;
    tpsPoints = [];
  }

  /** @returns {TurnTrackerState} */
  function read() {
    return { turn, lastTurn, tools, prompts, compactionLog, session };
  }

  return { onRuntimeEvent, foldEngineDeltas, liveTps, reset, read };
}
