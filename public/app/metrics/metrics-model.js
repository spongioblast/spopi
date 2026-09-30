// ABOUTME: Folds pi runtime events and vLLM /metrics scrapes into one snapshot.
// ABOUTME: A prompt spans every model call until agent_end. This file has no DOM or fetch.

/**
 * @typedef {{
 *   running: number,
 *   waiting: number,
 *   waitingCapacity: number,
 *   waitingDeferred: number,
 *   kvCachePct: number,
 *   preemptions: number,
 *   generationTokens: number,
 *   requestGenerationTokensSum: number,
 *   requestDecodeTimeSum: number,
 *   requestPrefillTimeSum: number,
 *   requestPrefillTimeCount: number,
 *   requestQueueTimeSum: number,
 *   requestQueueTimeCount: number,
 *   promptTokens: number,
 *   promptCompute: number,
 *   promptCacheHit: number,
 *   promptCached: number,
 *   prefixQueries: number,
 *   prefixHits: number,
 *   mmQueries: number,
 *   mmHits: number,
 *   itlSum: number,
 *   itlCount: number,
 *   ttftSum: number,
 *   ttftCount: number,
 *   iterationTokensSum: number,
 *   iterationTokensCount: number,
 *   specDrafts: number,
 *   specDraftTokens: number,
 *   specAcceptedTokens: number,
 *   waitingByReason?: Record<string, number>,
 * }} VllmServerSample
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
 * }} ServerRateDeltas
 *
 * @typedef {{
 *   decodeTps: number,
 *   prefillTps: number,
 *   cacheHitPct: number,
 *   prefixHitPct: number,
 *   specAcceptPct: number,
 *   tokensPerDraft: number,
 *   meanItlMs: number,
 *   meanQueueMs: number,
 *   meanPrefillMs: number,
 *   meanTtftMs: number,
 *   tokensPerStep: number,
 *   windowMs: number,
 *   decodeFromCounters?: boolean,
 *   deltas: ServerRateDeltas | null,
 * }} ServerRates
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
 *   ok: boolean | null,
 *   lastOkAt: number,
 *   error: string,
 *   latencyMs: number,
 *   scrapes: number,
 *   failures: number,
 * }} MetricsHealth
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
const TPS_WINDOW_MS = 3000;
/** Longest gap still folded into the live tokens/s estimate. */
const TPS_WINDOW_POINTS = 24;
/** How many prompts the scrollable log keeps, and how many feed the average. */
const PROMPT_LOG_LIMIT = 12;
/** Tool rows shown under one prompt: the newest ones; the rest are counted, not dropped silently. */
const PROMPT_TOOLS_LIMIT = 40;
/* Compactions are rare and each one explains a slow prompt, so a short log of
   them is worth keeping; pi can also compact while idle (`/compact`). */
const COMPACTION_LOG_LIMIT = 8;
const LOG_MERGE_LIMIT = 24;
/* A compaction that never saw its `compaction_end` (event lost, session reloaded
   mid-summariser) must not pulse forever, so it is flagged rather than trusted. */
const COMPACTION_STALE_MS = 120_000;
const PROMPT_AVG_WINDOW = 5;
/**
 * A prompt still absorbs engine deltas for this long after it ended, so the
 * scrape that fires on `agent_end` (which the overlay runs right after closing
 * the turn) is credited to the prompt that earned those tokens. Bounded, so a
 * stale prompt cannot absorb traffic from a later request.
 */
const CLOSE_GRACE_MS = 5000;

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

/** @type {Readonly<VllmServerSample>} */
const EMPTY_SERVER = Object.freeze({
  running: 0,
  waiting: 0,
  waitingCapacity: 0,
  waitingDeferred: 0,
  kvCachePct: 0,
  preemptions: 0,
  generationTokens: 0,
  requestGenerationTokensSum: 0,
  requestDecodeTimeSum: 0,
  requestPrefillTimeSum: 0,
  requestPrefillTimeCount: 0,
  requestQueueTimeSum: 0,
  requestQueueTimeCount: 0,
  promptTokens: 0,
  promptCompute: 0,
  promptCacheHit: 0,
  promptCached: 0,
  prefixQueries: 0,
  prefixHits: 0,
  mmQueries: 0,
  mmHits: 0,
  itlSum: 0,
  itlCount: 0,
  ttftSum: 0,
  ttftCount: 0,
  iterationTokensSum: 0,
  iterationTokensCount: 0,
  specDrafts: 0,
  specDraftTokens: 0,
  specAcceptedTokens: 0,
});

/** @type {Readonly<ServerRates>} */
const EMPTY_RATES = Object.freeze({
  decodeTps: 0,
  prefillTps: 0,
  cacheHitPct: 0,
  prefixHitPct: 0,
  specAcceptPct: 0,
  tokensPerDraft: 0,
  meanItlMs: 0,
  meanQueueMs: 0,
  meanPrefillMs: 0,
  meanTtftMs: 0,
  tokensPerStep: 0,
  windowMs: 0,
  deltas: null,
});

/**
 * @param {string} source
 * @returns {Record<string, string>}
 */
function parseLabels(source) {
  /** @type {Record<string, string>} */
  const labels = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"/g;
  let match = pattern.exec(source);
  while (match) {
    labels[match[1]] = match[2];
    match = pattern.exec(source);
  }
  return labels;
}

/**
 * Prometheus text -> flat counters. `_created` series carry unix timestamps
 * and would poison every delta, so they are skipped explicitly.
 *
 * @param {unknown} text
 * @returns {VllmServerSample}
 */
export function parseVllmMetrics(text) {
  /** @type {VllmServerSample} */
  const server = { ...EMPTY_SERVER, waitingByReason: {} };
  if (typeof text !== "string" || !text) return server;
  for (const line of text.split("\n")) {
    if (!line || line.charCodeAt(0) === 35 /* # */) continue;
    const cut = line.lastIndexOf(" ");
    if (cut <= 0) continue;
    const key = line.slice(0, cut);
    const value = Number(line.slice(cut + 1));
    if (!Number.isFinite(value)) continue;
    const brace = key.indexOf("{");
    const base = brace < 0 ? key : key.slice(0, brace);
    if (base.endsWith("_created") || !base.startsWith("vllm:")) continue;
    const name = base.slice("vllm:".length);
    const labels = brace < 0 ? null : parseLabels(key.slice(brace + 1, key.lastIndexOf("}")));
    switch (name) {
      case "num_requests_running":
        server.running = value;
        break;
      case "num_requests_waiting":
        server.waiting = value;
        break;
      case "num_requests_waiting_by_reason":
        if (labels?.reason === "capacity") server.waitingCapacity = value;
        else if (labels?.reason === "deferred") server.waitingDeferred = value;
        break;
      case "kv_cache_usage_perc":
        server.kvCachePct = Math.round(value * 1000) / 10;
        break;
      case "num_preemptions_total":
        server.preemptions = value;
        break;
      case "generation_tokens_total":
        server.generationTokens = value;
        break;
      case "prompt_tokens_total":
        server.promptTokens = value;
        break;
      case "prompt_tokens_cached_total":
        server.promptCached = value;
        break;
      case "prompt_tokens_by_source_total":
        if (labels?.source === "local_compute") server.promptCompute = value;
        else if (labels?.source === "local_cache_hit") server.promptCacheHit = value;
        break;
      case "prefix_cache_queries_total":
        server.prefixQueries = value;
        break;
      case "prefix_cache_hits_total":
        server.prefixHits = value;
        break;
      case "mm_cache_queries_total":
        server.mmQueries = value;
        break;
      case "mm_cache_hits_total":
        server.mmHits = value;
        break;
      case "request_generation_tokens_sum":
        server.requestGenerationTokensSum = value;
        break;
      case "request_decode_time_seconds_sum":
        server.requestDecodeTimeSum = value;
        break;
      case "request_prefill_time_seconds_sum":
        server.requestPrefillTimeSum = value;
        break;
      case "request_prefill_time_seconds_count":
        server.requestPrefillTimeCount = value;
        break;
      case "request_queue_time_seconds_sum":
        server.requestQueueTimeSum = value;
        break;
      case "request_queue_time_seconds_count":
        server.requestQueueTimeCount = value;
        break;
      case "inter_token_latency_seconds_sum":
        server.itlSum = value;
        break;
      case "inter_token_latency_seconds_count":
        server.itlCount = value;
        break;
      case "time_to_first_token_seconds_sum":
        server.ttftSum = value;
        break;
      case "time_to_first_token_seconds_count":
        server.ttftCount = value;
        break;
      case "iteration_tokens_total_sum":
        server.iterationTokensSum = value;
        break;
      case "iteration_tokens_total_count":
        server.iterationTokensCount = value;
        break;
      case "spec_decode_num_drafts_total":
        server.specDrafts = value;
        break;
      case "spec_decode_num_draft_tokens_total":
        server.specDraftTokens = value;
        break;
      case "spec_decode_num_accepted_tokens_total":
        server.specAcceptedTokens = value;
        break;
      default:
        break;
    }
  }
  return server;
}

/**
 * @param {unknown} previous
 * @param {unknown} next
 * @returns {number}
 */
function positiveDelta(previous, next) {
  const delta = (Number(next) || 0) - (Number(previous) || 0);
  // Negative means the engine restarted (counters reset); report "no traffic".
  return delta > 0 ? delta : 0;
}

/**
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Windowed rates between two scrapes. Lifetime averages would hide a stall,
 * so every value is derived from the deltas over `dtMs`.
 *
 * @param {VllmServerSample | null | undefined} previous
 * @param {VllmServerSample | null | undefined} next
 * @param {number} dtMs
 * @returns {ServerRates}
 */
export function deriveServerRates(previous, next, dtMs) {
  /** @type {ServerRates} */
  const rates = { ...EMPTY_RATES };
  if (!previous || !next || !(dtMs > 0)) return rates;
  const seconds = dtMs / 1000;
  const decode = positiveDelta(previous.generationTokens, next.generationTokens);
  const prefill = positiveDelta(previous.promptCompute, next.promptCompute);
  const prompt = positiveDelta(previous.promptTokens, next.promptTokens);
  const cached = positiveDelta(previous.promptCached, next.promptCached);
  const prefixQueries = positiveDelta(previous.prefixQueries, next.prefixQueries);
  const prefixHits = positiveDelta(previous.prefixHits, next.prefixHits);
  const drafts = positiveDelta(previous.specDrafts, next.specDrafts);
  const draftTokens = positiveDelta(previous.specDraftTokens, next.specDraftTokens);
  const accepted = positiveDelta(previous.specAcceptedTokens, next.specAcceptedTokens);
  const itl = positiveDelta(previous.itlSum, next.itlSum);
  const itlCount = positiveDelta(previous.itlCount, next.itlCount);
  const ttft = positiveDelta(previous.ttftSum, next.ttftSum);
  const ttftCount = positiveDelta(previous.ttftCount, next.ttftCount);
  const stepTokens = positiveDelta(previous.iterationTokensSum, next.iterationTokensSum);
  const steps = positiveDelta(previous.iterationTokensCount, next.iterationTokensCount);
  // A wall-clock window average dilutes with any idle time inside it, so decode
  // speed comes from the engine's own decode-time counter when available: that
  // counts only seconds actually spent decoding, never queue or tool time.
  const decodeTime = positiveDelta(previous.requestDecodeTimeSum, next.requestDecodeTimeSum);
  const requestGenTokens = positiveDelta(
    previous.requestGenerationTokensSum,
    next.requestGenerationTokensSum,
  );
  const prefillTime = positiveDelta(previous.requestPrefillTimeSum, next.requestPrefillTimeSum);
  const prefillCount = positiveDelta(
    previous.requestPrefillTimeCount,
    next.requestPrefillTimeCount,
  );
  const queueTime = positiveDelta(previous.requestQueueTimeSum, next.requestQueueTimeSum);
  const queueCount = positiveDelta(previous.requestQueueTimeCount, next.requestQueueTimeCount);
  const decodeMeasured = decodeTime > 0.02 && requestGenTokens > 0;
  const prefillMeasured = prefillTime > 0.02 && prefill > 0;
  /** @type {ServerRates} */
  return {
    decodeTps: decodeMeasured ? requestGenTokens / decodeTime : decode / seconds,
    prefillTps: prefillMeasured ? prefill / prefillTime : prefill / seconds,
    cacheHitPct: ratio(cached, prompt) * 100,
    prefixHitPct: ratio(prefixHits, prefixQueries) * 100,
    specAcceptPct: ratio(accepted, draftTokens) * 100,
    tokensPerDraft: ratio(accepted, drafts),
    meanItlMs: decodeMeasured
      ? (decodeTime / requestGenTokens) * 1000
      : ratio(itl, itlCount) * 1000,
    meanTtftMs: ratio(ttft, ttftCount) * 1000,
    // Per-request means: waiting costs in ms, kept apart from decode speed.
    meanQueueMs: ratio(queueTime, queueCount) * 1000,
    meanPrefillMs: ratio(prefillTime, prefillCount) * 1000,
    tokensPerStep: ratio(stepTokens, steps),
    windowMs: dtMs,
    decodeFromCounters: decodeMeasured,
    deltas: {
      genTokens: decode,
      promptTokens: prompt,
      promptCached: cached,
      decodeTime,
      promptCompute: prefill,
      prefillTime,
      ttftSum: ttft,
      ttftCount,
      queueTime,
      queueCount,
      prefillCount,
      drafts,
      draftTokens,
      accepted,
    },
  };
}

/**
 * @param {unknown[]} values
 * @returns {string}
 */
function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Full one-line description of a tool call, untruncated (used for tooltips).
 *
 * @param {unknown} toolName
 * @param {unknown} args
 * @returns {string}
 */
export function describeToolArgs(toolName, args) {
  const source =
    args && typeof args === "object" ? /** @type {Record<string, unknown>} */ (args) : {};
  return (
    firstString([
      source.command,
      source.cmd,
      source.path,
      source.file,
      source.filePath,
      source.pattern,
      source.query,
      source.prompt,
      source.url,
      source.subject,
      source.title,
      source.message,
    ]) || (toolName === "todo" ? "todo" : "")
  );
}

/**
 * Display label for a tool call. Long enough that the card's own CSS ellipsis
 * (not a hard slice) is what the user perceives as truncation.
 *
 * @param {unknown} toolName
 * @param {unknown} args
 * @param {number} [limit]
 * @returns {string}
 */
export function summarizeToolArgs(toolName, args, limit = 160) {
  const text = describeToolArgs(toolName, args);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

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
 * @param {CreateMetricsModelOptions} [options]
 * @returns {MetricsModelApi}
 */
export function createMetricsModel({
  now = () => Date.now(),
  historyLimit = TOOL_HISTORY_LIMIT,
} = {}) {
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
  // `tokens` is the session's generated-token total: pi's usage where it
  // arrived, the engine's counter otherwise.
  const session = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cost: 0, turns: 0, tokens: 0 };

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
   * Live tokens/s from pi's own streaming `usage.output`, over a short window.
   *
   * @param {number} [_at]
   * @returns {number}
   */
  function liveTps(_at = now()) {
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
    // Fold this window's engine deltas into the running prompt, so its speed is
    // a cumulative average over that prompt alone.
    if (rates.deltas && turn && (!turn.finishedAt || at - turn.finishedAt <= CLOSE_GRACE_MS)) {
      if (!turn.engine) turn.engine = emptyEngine();
      const stats = turn.engine;
      const accum = /** @type {Record<string, number>} */ (stats);
      for (const [key, value] of Object.entries(rates.deltas)) accum[key] += value;
      // kvCachePct is already a percentage; do not scale it again.
      stats.kvPeak = Math.max(stats.kvPeak, parsed.kvCachePct || 0);
    }
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
    turn = null;
    lastTurn = null;
    tools = [];
    prompts = [];
    compactionLog = [];
    compactionSeq = 0;
    turnSeq = 0;
    tpsPoints = [];
    rates = { ...EMPTY_RATES };
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
  function promptView(source, at, isActive) {
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
  function compactionView(entry, sources, at) {
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

  /**
   * @param {number} [at]
   * @returns {MetricsSnapshot}
   */
  function snapshot(at = now()) {
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
        liveTps: liveTps(at),
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
    onRuntimeEvent,
    recordServerScrape,
    recordServerFailure,
    reset,
    setModelInfo,
    snapshot,
  };
}
