// ABOUTME: Parses vLLM's Prometheus /metrics text and derives windowed rates between two scrapes.
// ABOUTME: Pure functions over counters; turns, prompts, and fetching live elsewhere.

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
 */

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
export const EMPTY_RATES = Object.freeze({
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
export function ratio(numerator, denominator) {
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
