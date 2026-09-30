// ABOUTME: Cockpit: Pi's turn telemetry for any model, plus model-server counters when its /metrics answers.
// ABOUTME: Renders only from MetricsModel snapshots, so scraping and rendering stay independent of each other.

import { uiStore } from "../storage/ui-store.js";
import { copyText } from "../ui/clipboard.js";
import { cacheWarmingControl, cacheWarmingSegments } from "./cache-warming-control.js";
import {
  clockTime,
  fmtInt,
  fmtMs,
  fmtPct,
  fmtTps,
  num,
  phaseLabel,
  resolveMetricsUrl,
  translate,
} from "./metrics-format.js";
import { cacheSharePct, createMetricsModel } from "./metrics-model.js";
import {
  clampThinkingBudget,
  formatThinkingBudget,
  nextThinkingBudget,
} from "./thinking-budget.js";

export { phaseLabel };

/**
 * @typedef {{
 *   getItem?: (key: string) => string | null,
 *   setItem?: (key: string, value: string) => void,
 * }} MetricsStorage
 *
 * @typedef {{
 *   id?: string,
 *   thinkingLevel?: string,
 *   provider?: string,
 *   baseUrl?: string,
 *   thinkingBudgetField?: string,
 * }} MetricsModelInfo
 *
 * @typedef {{
 *   meanItlMs?: number,
 *   meanTtftMs?: number,
 *   meanQueueMs?: number,
 *   meanPrefillMs?: number,
 *   tokensPerStep?: number,
 *   genTokens?: number,
 *   specAcceptPct?: number,
 *   kvPeakPct?: number,
 * }} MetricsEngineView
 *
 * @typedef {{
 *   out?: boolean,
 *   in?: boolean,
 *   cached?: boolean,
 *   think?: boolean,
 * }} MetricsPromptEstimated
 *
 * @typedef {{
 *   id?: string,
 *   status?: string,
 *   startedAt?: number,
 *   finishedAt?: number,
 *   durationMs?: number,
 *   toolName?: string,
 *   label?: string,
 *   title?: string,
 * }} MetricsToolView
 *
 * @typedef {{
 *   id?: number,
 *   startedAt?: number,
 *   finishedAt?: number,
 *   active?: boolean,
 *   phase?: string,
 *   durationMs?: number,
 *   genMs?: number,
 *   inputTokens?: number,
 *   cacheReadTokens?: number,
 *   cacheSharePct?: number,
 *   outputTokens?: number,
 *   reasoningTokens?: number,
 *   cost?: number,
 *   estimated?: MetricsPromptEstimated,
 *   textChars?: number,
 *   thinkingChars?: number,
 *   compactions?: number,
 *   retries?: number,
 *   decodeTps?: number,
 *   engine?: MetricsEngineView | null,
 *   callOutputs?: number[],
 *   tools?: MetricsToolView[],
 *   toolCount?: number,
 * }} MetricsPromptView
 *
 * @typedef {{
 *   id?: number,
 *   startedAt?: number,
 *   finishedAt?: number,
 *   status?: string,
 *   reason?: string,
 *   before?: number,
 *   after?: number,
 *   afterAt?: number,
 *   summaryTokens?: number,
 *   error?: string,
 *   turnId?: number,
 *   durationMs?: number,
 *   stale?: boolean,
 *   saved?: number,
 * }} MetricsCompactionView
 *
 * @typedef {{ kind: "prompt", at?: number, prompt: MetricsPromptView }} MetricsLogPrompt
 * @typedef {{ kind: "compaction", at?: number, compaction: MetricsCompactionView }} MetricsLogCompaction
 * @typedef {MetricsLogPrompt | MetricsLogCompaction} MetricsLogItem
 *
 * @typedef {{
 *   elapsedMs?: number,
 *   liveTps?: number,
 * }} MetricsTurnView
 *
 * @typedef {{
 *   meanItlMs?: number,
 *   meanTtftMs?: number,
 *   meanQueueMs?: number,
 *   meanPrefillMs?: number,
 *   tokensPerStep?: number,
 * }} MetricsRatesView
 *
 * @typedef {{
 *   kvCachePct?: number,
 * }} MetricsServerView
 *
 * @typedef {{
 *   ok?: boolean | null,
 *   lastOkAt?: number,
 *   error?: string,
 *   latencyMs?: number,
 * }} MetricsHealthView
 *
 * @typedef {{
 *   tokens?: number, input?: number, cacheRead?: number,
 *   turns?: number,
 * }} MetricsSessionView
 *
 * @typedef {{
 *   active?: boolean,
 *   phase?: string,
 *   prompt?: MetricsPromptView | null,
 *   log?: MetricsLogItem[],
 *   avgDecodeTps?: number,
 *   turn?: MetricsTurnView,
 *   model?: MetricsModelInfo | null,
 *   server?: MetricsServerView | null,
 *   rates?: MetricsRatesView | null,
 *   health?: MetricsHealthView,
 *   session?: MetricsSessionView,
 * }} MetricsSnapshot
 *
 * @typedef {{
 *   onRuntimeEvent: (event: unknown, at?: number) => void,
 *   recordServerScrape: (text: string, meta?: { at?: number, latencyMs?: number }) => unknown,
 *   recordServerFailure: (error: unknown, meta?: { at?: number, latencyMs?: number }) => void,
 *   snapshot: (at?: number) => MetricsSnapshot,
 * }} MetricsModelApi
 *
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} MetricsFetch
 *
 * @typedef {{
 *   raw?: { text?: string, error?: string },
 *   text?: string,
 *   metricsUrl?: string,
 * }} MetricsScrapeResult
 *
 * @typedef {(args: {
 *   baseUrl: string,
 *   metricsUrl: string,
 * }) => Promise<MetricsScrapeResult | null | undefined>} MetricsScrapeFn
 *
 * @typedef {{
 *   foot: HTMLElement,
 *   kvRow: HTMLElement,
 *   kvFill: HTMLElement,
 *   kvText: HTMLElement,
 *   list: HTMLElement,
 *   modelLabel: HTMLElement,
 *   phase: HTMLElement,
 *   thinking: HTMLButtonElement,
 *   stats: HTMLElement,
 *   turnTime: HTMLElement,
 * }} MetricsOverlayEls
 *
 * @typedef {{ left: number, top: number }} MetricsPosition
 */

const OPEN_TICK_MS = 250;
const SCRAPE_TIMEOUT_MS = 2500;
/** Floor between event-driven scrapes while the card is closed. */
const EVENT_SCRAPE_MIN_MS = 2000;
const URL_KEY = "ui.metrics.url";

/* Colours live in metrics-overlay.css (.metrics-phase.<state>), which owns the
   token choice: thinking/tool states reuse the tool-card accents. */
/** @type {Record<string, string>} */
const PHASE_STATES = {
  idle: "idle",
  working: "accent",
  thinking: "thinking",
  streaming: "accent",
  toolcall: "tool",
  tool: "tool",
  compacting: "warning",
  retrying: "warning",
};

/** @type {Record<string, string>} */
const TOOL_GLYPHS = { running: "◐", ok: "✓", error: "✕" };
/* Compaction gets its own glyph family: it is a session-level event, not a
   tool, and `↺` reads as "the context was rewritten". */
/** @type {Record<string, string>} */
const COMPACTION_GLYPHS = {
  running: "◐",
  ok: "↺",
  retrying: "↻",
  aborted: "⊘",
  error: "✕",
};
const COPY_GLYPH = "⎘";

/**
 * @param {MetricsStorage | null | undefined} storage
 * @param {string} key
 */
function readStored(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * The counters the Cockpit reads are vLLM's Prometheus names. A server without
 * them (LM Studio, Ollama, a cloud API) simply has no server panel.
 * @param {string} text
 */
function hasServerMetrics(text) {
  return /^vllm:/m.test(text);
}

/**
 * @param {MetricsStorage | null | undefined} storage
 * @param {string} key
 * @param {string} value
 */
function writeStored(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    /* private mode / disabled storage: the metrics URL is not remembered */
  }
}

export class MetricsOverlay {
  /** @type {MetricsModelApi} */
  #model;
  /** @type {(() => MetricsModelInfo | null | undefined) | null} */
  #getModelInfo;
  /** @type {MetricsStorage} */
  #storage;
  /** @type {MetricsFetch} */
  #fetchImpl;
  /** The user's metrics URL; empty means `/metrics` at the current model's server. */
  /** @type {string} */
  #metricsUrl;
  /** The URL the last scrape actually read, for the footer. */
  /** @type {string} */
  #scrapedUrl = "";
  /** @type {HTMLElement | null} */
  #root = null;
  /** @type {MetricsOverlayEls | null} */
  #els = null;
  /** @type {boolean} */
  #open = false;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  #timer = 0;
  /** @type {number} */
  #tickMs;
  /** @type {boolean} */
  #scrapeInFlight = false;
  /** @type {string} */
  #lastLogSignature = "";
  /** @type {number} */
  #lastEventScrapeAt = 0;
  /** Rows are not rebuilt until this moment, so copy feedback survives a live re-render. */
  /** @type {number} */
  #copyHoldUntil = 0;
  /** @type {HTMLElement | null} */
  #trigger = null;
  /** @type {((event: KeyboardEvent) => void) | null} */
  #onKeyDown = null;
  /** @type {HTMLElement | null} */
  #home = null;
  /** @type {boolean} */
  #docked = true;
  /** @type {MetricsScrapeFn | null} */
  #scrapeFn = null;
  /** @type {((budget: number, info: { level: string }) => void) | null} */
  #onThinkingBudget = null;
  /** @type {((snapshot: MetricsSnapshot) => void) | null} */
  #onSnapshot = null;
  /** @type {number} */
  #thinkingBudget = 0;

  /**
   * @param {object} [options]
   * @param {ParentNode | null | undefined} [options.container]
   * @param {MetricsModelApi} [options.model]
   * @param {(() => MetricsModelInfo | null | undefined) | null} [options.getModelInfo]
   * @param {string | null} [options.metricsUrl]
   * @param {MetricsStorage} [options.storage]
   * @param {MetricsFetch | null} [options.fetchImpl]
   * @param {number} [options.tickMs]
   * @param {MetricsScrapeFn | null} [options.scrapeFn]
   * @param {((budget: number, info: { level: string }) => void) | null} [options.onThinkingBudget]
   * @param {((snapshot: MetricsSnapshot) => void) | null} [options.onSnapshot]
   * @param {number} [options.thinkingBudget]
   */
  constructor({
    container = document.body,
    model = createMetricsModel(),
    getModelInfo = null,
    metricsUrl = null,
    storage = uiStore,
    fetchImpl = null,
    tickMs = OPEN_TICK_MS,
    scrapeFn = null,
    onThinkingBudget = null,
    onSnapshot = null,
    thinkingBudget = 0,
  } = {}) {
    this.#model = /** @type {MetricsModelApi} */ (model);
    this.#getModelInfo = getModelInfo;
    this.#storage = storage;
    this.#fetchImpl =
      fetchImpl ||
      ((url, init) => {
        return globalThis.fetch(url, init);
      });
    this.#metricsUrl = resolveMetricsUrl(readStored(storage, URL_KEY), metricsUrl);
    this.#tickMs = tickMs;
    this.#docked = true;
    this.#scrapeFn = scrapeFn;
    this.#onThinkingBudget = onThinkingBudget;
    this.#onSnapshot = onSnapshot;
    this.#thinkingBudget = clampThinkingBudget(thinkingBudget);
    this.#build(container);
    this.#home = container instanceof HTMLElement ? container : null;
    this.open();
    this.#listenForPhoneCockpit();
    this.#startTimer();
  }

  get isOpen() {
    return this.#open;
  }

  get metricsUrl() {
    return this.#metricsUrl;
  }

  get model() {
    return this.#model;
  }

  /** @param {unknown} value */
  setThinkingBudget(value) {
    this.#thinkingBudget = clampThinkingBudget(value);
    this.#paintThinking();
  }

  /** @param {unknown} next */
  setMetricsUrl(next) {
    this.#metricsUrl = resolveMetricsUrl(next, null);
    writeStored(this.#storage, URL_KEY, this.#metricsUrl);
    void this.#scrape();
  }

  /** Makes the header status pill the click target for the overlay.
   * @param {object} [options]
   * @param {HTMLElement | null | undefined} [options.statusText]
   * @param {HTMLElement | null | undefined} [options.statusIndicator]
   * @param {HTMLElement | null | undefined} [options.statusRow]
   */
  bind({ statusText, statusIndicator, statusRow } = {}) {
    if (this.#docked) return;
    const row = statusRow || statusText?.parentElement || null;
    if (!row || this.#trigger === row) return;
    this.#trigger = row;
    row.classList.add("metrics-trigger");
    row.title = translate("metrics.triggerTitle", "Session & server metrics");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.addEventListener("click", (event) => {
      event.preventDefault();
      this.toggle();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggle();
      }
    });
    if (statusIndicator) statusIndicator.title = row.title;
  }

  /**
   * Feed the model the runtime event (forwarding the optional clock so tests
   * and replays can drive timestamps) and keep engine stats complete for it.
   */
  phase() {
    return this.#model.snapshot().phase;
  }

  /**
   * @param {unknown} event
   * @param {number} [at]
   */
  onRuntimeEvent(event, at) {
    this.#model.onRuntimeEvent(event, at);
    this.#eventScrape(event);
  }

  /**
   * Keep per-prompt engine stats complete even while the card is closed by
   * scraping the moments that matter instead of polling: once when a prompt
   * starts, throttled as its tools finish, and once when it ends. Two scrapes
   * already make the counters a true window over the whole prompt, so the
   * headline number stays the engine's own measurement rather than an estimate.
   * @param {unknown} event
   */
  #eventScrape(event) {
    if (this.#open || !event || typeof event !== "object") return;
    const now = Date.now();
    const fire = () => {
      this.#lastEventScrapeAt = now;
      this.#scrape();
    };
    const typed = /** @type {{ type?: string, message?: { role?: string } }} */ (event);
    if (
      typed.type === "agent_start" ||
      typed.type === "agent_end" ||
      typed.type === "agent_settled"
    ) {
      fire();
      return;
    }
    const milestone =
      typed.type === "tool_execution_end" ||
      (typed.type === "message_end" && typed.message?.role === "assistant");
    if (milestone && now - this.#lastEventScrapeAt >= EVENT_SCRAPE_MIN_MS) fire();
  }

  toggle() {
    if (this.#open) this.close();
    else this.open();
  }

  open() {
    if (this.#open) return;
    const root = this.#root;
    if (!root) return;
    this.#open = true;
    root.classList.remove("hidden");
    this.#startTimer();
    void this.#scrape();
    this.#render();
  }

  close() {
    if (!this.#open) return;
    const root = this.#root;
    if (!root) return;
    this.#open = false;
    root.classList.add("hidden");
    this.#startTimer();
  }

  destroy() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = 0;
    if (this.#onKeyDown) document.removeEventListener("keydown", this.#onKeyDown);
    this.#root?.remove();
    this.#root = null;
  }

  /** @param {ParentNode | null | undefined} container */
  #build(container) {
    const root = document.createElement("div");
    root.className = "metrics-overlay hidden";
    root.id = "metrics-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", translate("metrics.title", "Metrics"));

    const head = document.createElement("div");
    head.className = "metrics-head";
    const title = document.createElement("span");
    title.className = "metrics-title";
    title.textContent = translate("metrics.title", "Metrics");
    const modelLabel = document.createElement("span");
    modelLabel.className = "metrics-model";
    head.append(title, modelLabel);

    const body = document.createElement("div");
    body.className = "metrics-body";

    const now = document.createElement("section");
    now.className = "metrics-section metrics-now";
    const phase = document.createElement("span");
    phase.className = "metrics-phase";
    const turnTime = document.createElement("span");
    turnTime.className = "metrics-turn-time";
    const nowHead = document.createElement("div");
    nowHead.className = "metrics-now-head";
    nowHead.append(phase, turnTime);
    const stats = document.createElement("div");
    stats.className = "metrics-chip-row";

    const kvRow = document.createElement("div");
    kvRow.className = "metrics-kv";
    const kvBar = document.createElement("div");
    kvBar.className = "metrics-bar";
    const kvFill = document.createElement("i");
    kvBar.append(kvFill);
    const kvText = document.createElement("span");
    kvText.className = "metrics-bar-label";
    kvRow.append(kvBar, kvText);

    const log = document.createElement("section");
    log.className = "metrics-section metrics-log-section";
    log.append(this.#sectionTitle(translate("metrics.log", "Prompts & tools")));
    const list = document.createElement("ul");
    list.className = "metrics-log";
    log.append(list);

    const foot = document.createElement("div");
    foot.className = "metrics-foot";

    const thinking = document.createElement("button");
    thinking.type = "button";
    thinking.className = "ui-button ui-button--sm ui-button--ghost metrics-thinking";
    thinking.addEventListener("click", () => {
      this.#thinkingBudget = nextThinkingBudget(this.#thinkingBudget);
      this.#paintThinking();
      const info = this.#getModelInfo?.() || {};
      const onThinkingBudget = this.#onThinkingBudget;
      onThinkingBudget?.(this.#thinkingBudget, {
        level: info.thinkingLevel || "high",
      });
    });
    if (this.#docked) {
      nowHead.append(modelLabel);
      now.append(nowHead, kvRow);
      const controls = document.createElement("div");
      controls.className = "metrics-controls";
      controls.append(cacheWarmingSegments(), thinking);
      const footRow = document.createElement("div");
      footRow.className = "metrics-foot-row";
      footRow.append(foot);
      body.append(now, stats, log, controls, footRow);
      root.append(body);
    } else {
      now.append(nowHead, stats, kvRow);
      body.append(now, log, foot, thinking);
      root.append(head, body);
    }
    if (this.#docked) {
      root.classList.add("docked");
      root.classList.remove("hidden");
    }
    container?.append(root);

    this.#root = root;
    this.#els = {
      foot,
      kvRow,
      kvFill,
      kvText,
      list,
      modelLabel,
      phase,
      thinking,
      stats,
      turnTime,
    };

    this.#onKeyDown = (event) => {
      if (this.#open && event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
    };
    document.addEventListener("keydown", this.#onKeyDown);
  }

  /** @param {string} text */
  #sectionTitle(text) {
    const label = document.createElement("div");
    label.className = "metrics-section-title";
    label.textContent = text;
    return label;
  }

  #listenForPhoneCockpit() {
    if (typeof document === "undefined") return;
    document.addEventListener("spopi-show-cockpit", (event) => {
      const host = event instanceof CustomEvent ? event.detail?.host : null;
      if (host instanceof HTMLElement) this.#showIn(host);
    });
  }

  /** @param {HTMLElement} host */
  #showIn(host) {
    const root = this.#root;
    if (!root) return;
    const home = this.#home;
    host.append(root);
    root.classList.add("docked");
    this.open();
    if (!home) return;
    const watcher = new MutationObserver(() => {
      if (host.isConnected) return;
      watcher.disconnect();
      if (root.isConnected) return;
      home.append(root);
    });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
  }

  #startTimer() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = 0;
    // No background polling at all while closed: opening the overlay scrapes
    // immediately, and the 250 ms tick fills the sparkline within half a second.
    if (!this.#open) return;
    this.#timer = setInterval(() => {
      void this.#scrape();
      this.#render();
    }, this.#tickMs);
  }

  async #scrape() {
    if (this.#scrapeInFlight) return;
    if (typeof document !== "undefined" && document.hidden && !this.#open) return;
    this.#scrapeInFlight = true;
    const startedAt = Date.now();
    /** @type {AbortController | null} */
    let controller = null;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    let timeout = 0;
    try {
      const scrapeFn = this.#scrapeFn;
      this.#scrapedUrl = "";
      if (scrapeFn) {
        const info = this.#getModelInfo?.() || {};
        const baseUrl = String(info.baseUrl || this.#metricsUrl.replace(/\/metrics$/, ""));
        if (!baseUrl) throw new Error("no model server");
        const snapshot = await scrapeFn({
          baseUrl,
          metricsUrl: this.#metricsUrl,
        });
        this.#scrapedUrl = snapshot?.metricsUrl || this.#metricsUrl;
        const text = snapshot?.raw?.text || snapshot?.text || "";
        if (!text) throw new Error(snapshot?.raw?.error || "no answer");
        if (!hasServerMetrics(text)) throw new Error("no server metrics");
        this.#model.recordServerScrape(text, { at: Date.now(), latencyMs: Date.now() - startedAt });
        return;
      }
      if (!this.#metricsUrl) throw new Error("no model server");
      this.#scrapedUrl = this.#metricsUrl;
      /** @type {RequestInit} */
      const init = { cache: "no-store", redirect: "follow" };
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        init.signal = controller.signal;
        const abortController = controller;
        timeout = setTimeout(() => abortController.abort(), SCRAPE_TIMEOUT_MS);
      }
      const response = await this.#fetchImpl(this.#metricsUrl, init);
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "?"}`);
      const text = await response.text();
      if (!hasServerMetrics(text)) throw new Error("no server metrics");
      this.#model.recordServerScrape(text, { at: Date.now(), latencyMs: Date.now() - startedAt });
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error ? error.message : error;
      this.#model.recordServerFailure(message || error, {
        at: Date.now(),
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.#scrapeInFlight = false;
    }
  }

  /**
   * @param {string} label
   * @param {string} value
   * @param {string} [tone]
   */
  #chip(label, value, tone = "") {
    const chip = document.createElement("span");
    chip.className = `pill metrics-chip${tone ? ` ${tone}` : ""}`;
    const name = document.createElement("b");
    name.textContent = label;
    const body = document.createElement("span");
    body.textContent = value;
    chip.append(name, body);
    return chip;
  }

  #render() {
    const els = this.#els;
    if (!els) return;
    const snapshot = this.#model.snapshot();
    const info = this.#getModelInfo?.() || snapshot.model || {};

    els.modelLabel.textContent = [info.id, info.thinkingLevel && `thinking ${info.thinkingLevel}`]
      .filter(Boolean)
      .join(" · ");

    const phase = snapshot.phase || "idle";
    els.phase.textContent = phaseLabel(phase);
    els.phase.className = `metrics-phase ${PHASE_STATES[phase] || PHASE_STATES.idle}`;
    const turn = snapshot.turn || {};
    els.turnTime.textContent = snapshot.active ? fmtMs(turn.elapsedMs) : "";

    /** @type {MetricsPromptView} */
    const prompt = snapshot.prompt || {};
    /** @type {MetricsEngineView} */
    const engine = prompt.engine || {};
    /** @type {MetricsRatesView} */
    const rates = snapshot.rates || {};
    // Cumulative-since-turn-start rates: they tick continuously while the model
    // works and settle on the final number the moment the prompt finishes.
    const decodeTps = prompt.decodeTps || (snapshot.active ? turn.liveTps : 0);
    // `≈` marks values that come from the engine's counters rather than pi's
    // usage report, which only arrives when the prompt ends.
    /** @type {MetricsPromptEstimated} */
    const est = prompt.estimated || {};
    /**
     * @param {unknown} value
     * @param {boolean | undefined} flag
     */
    const count = (value, flag) => (flag ? `≈${fmtInt(value)}` : fmtInt(value));
    // Labels follow the usual serving-stack vocabulary: throughput in tok/s, and
    // every waiting cost in its own milliseconds, so the two never blur.
    const chipOut = this.#chip("out", count(prompt.outputTokens, est.out));
    chipOut.title = `output tokens this prompt · ${fmtInt(prompt.reasoningTokens)} thinking · ${fmtInt(prompt.textChars)} text chars${prompt.cost ? ` · $${prompt.cost.toFixed(4)}` : ""}`;
    const chipPrompt = this.#chip("prompt", count(prompt.inputTokens, est.in));
    chipPrompt.title = translate("metrics.promptTitle", "prompt tokens");
    // Same honesty rule as the counts: without engine counters the rate is the
    // client-side estimate (out / generation window), so it is marked as one.
    const tpsEstimated = !prompt.engine && (decodeTps || 0) > 0;
    const chipTps = this.#chip("tok/s", `${tpsEstimated ? "≈" : ""}${fmtTps(decodeTps)}`, "accent");
    chipTps.title = translate(
      "metrics.tpsTitle",
      "per-request output throughput · excludes queue, prefill and TTFT",
    );
    if (tpsEstimated)
      chipTps.title = `${chipTps.title} · estimated from output ÷ generation window`;
    const chipTpot = this.#chip("TPOT", fmtMs(engine.meanItlMs || rates.meanItlMs));
    chipTpot.title = translate(
      "metrics.tpotTitle",
      "time per output token · vLLM: inter_token_latency_seconds",
    );
    const chipTtft = this.#chip("TTFT", fmtMs(engine.meanTtftMs || rates.meanTtftMs));
    chipTtft.title = translate(
      "metrics.ttftTitle",
      "time to first token · queue + prefill + scheduling",
    );
    const chipQueue = this.#chip("queue", fmtMs(engine.meanQueueMs || rates.meanQueueMs));
    chipQueue.title = translate("metrics.queueTitle", "waiting for KV blocks or the scheduler");
    const chipPrefill = this.#chip("prefill", fmtMs(engine.meanPrefillMs || rates.meanPrefillMs));
    chipPrefill.title = translate("metrics.prefillTitle", "prompt processing time");
    const acceptLen = engine.tokensPerStep || rates.tokensPerStep || 0;
    const chipAccept = this.#chip(
      "accept len",
      acceptLen >= 1 ? acceptLen.toFixed(2) : "—",
      acceptLen > 1 ? "success" : "",
    );
    chipAccept.title = translate(
      "metrics.acceptTitle",
      "accepted tokens per step, including the guaranteed token (MTP speculation)",
    );
    const session = snapshot.session || {};
    const chipCache = this.#chip(
      translate("metrics.cacheHit", "Cache hit"),
      `${Math.round(prompt.cacheSharePct || 0)}% · ${Math.round(cacheSharePct(session.input, session.cacheRead))}%`,
    );
    const chipSession = this.#chip("session", fmtInt(session.tokens || 0));
    chipSession.title = translate("metrics.sessionTitle", "output tokens generated this session");
    const chipTurn = this.#chip("turn", fmtMs(prompt.durationMs));
    chipTurn.title = translate("metrics.turnDuration", "prompt wall time");
    const health = snapshot.health || {};
    // Latency breakdown and KV cache come only from the model server's own
    // counters; without them the Cockpit shows what Pi reports for every model.
    const serverLive = health.ok === true;
    const chips = [
      chipOut,
      chipPrompt,
      chipTps,
      ...(serverLive ? [chipTpot, chipTtft, chipQueue, chipPrefill, chipAccept] : []),
      chipCache,
      chipSession,
      chipTurn,
    ];
    if (!this.#docked) chips.splice(2, 0, cacheWarmingControl());
    els.stats.replaceChildren(...chips);
    els.kvRow.hidden = !serverLive;

    /** @type {MetricsServerView} */
    const server = snapshot.server || {};
    const kv = Math.max(0, Math.min(100, num(server.kvCachePct)));
    const kvPeak = Math.max(0, Math.min(100, Math.max(kv, num(prompt.engine?.kvPeakPct))));
    els.kvFill.style.width = `${kv}%`;
    els.kvFill.classList.toggle("hot", kv > 80);
    els.kvText.textContent = `KV cache ${kv ? kv.toFixed(1) : "0"}%${kvPeak > kv ? ` · peak ${kvPeak.toFixed(1)}%` : ""}`;

    this.#renderLog(snapshot.log);

    const age = health.lastOkAt ? Math.max(0, Date.now() - health.lastOkAt) : 0;
    const turns = session.turns || 0;
    const avg = snapshot.avgDecodeTps ? ` · avg ${fmtTps(snapshot.avgDecodeTps)} t/s` : "";
    const sessionPart = turns ? ` · ${turns} prompt${turns === 1 ? "" : "s"}${avg}` : "";
    // Strip only the scheme. Dropping the host too (an earlier draft) left a
    // bare ":8000/metrics" in the footer, which reads as a broken string.
    const scraped = this.#scrapedUrl || this.#metricsUrl;
    const shownUrl = scraped.replace(/^https?:\/\//, "");
    els.foot.textContent = serverLive
      ? `${shownUrl} · ${health.latencyMs} ms · ${Math.round(age / 1000)}s ago${sessionPart}`
      : `${translate("metrics.noServerMetrics", "No model-server metrics")}${shownUrl ? ` at ${shownUrl}` : ""}${sessionPart}`;
    els.foot.title = health.ok === false && health.error ? `${scraped} — ${health.error}` : scraped;
    els.foot.classList.remove("error");
    this.#paintThinking();
    const onSnapshot = this.#onSnapshot;
    onSnapshot?.(snapshot);
  }

  #paintThinking() {
    const els = this.#els;
    if (!els) return;
    const thinking = els.thinking;
    if (!thinking) return;
    const info = this.#getModelInfo?.() || {};
    // Pi sends a budget only for a model with `compat.thinkingTokenBudgetField`.
    const budgeted = Boolean(info.thinkingBudgetField);
    thinking.hidden = !budgeted;
    thinking.disabled = !budgeted;
    const level = info.thinkingLevel || "high";
    thinking.textContent = `thinking ${level} · ${formatThinkingBudget(this.#thinkingBudget)}`;
    thinking.title = translate(
      "metrics.thinkingBudgetTitle",
      "Cycle the thinking token budget for this thinking level",
    );
  }

  /**
   * @param {object} row
   * @param {string} row.kind
   * @param {string} [row.state]
   * @param {number} [row.at]
   * @param {string} row.glyph
   * @param {string} row.text
   * @param {string} row.right
   * @param {string} [row.rightTitle]
   * @param {string} [row.title]
   * @param {string} [row.copy]
   * @param {string} [row.copyTitle]
   */
  #logRow({
    kind,
    state = "",
    at,
    glyph,
    text,
    right,
    rightTitle = "",
    title = "",
    copy = "",
    copyTitle = "",
  }) {
    const row = document.createElement("li");
    row.className = `metrics-log-row metrics-log-${kind}${state ? ` ${state}` : ""}`;
    const time = document.createElement("span");
    time.className = "metrics-log-time";
    time.textContent = at ? clockTime(at) : "";
    const mark = document.createElement("span");
    mark.className = "metrics-log-glyph";
    mark.textContent = glyph;
    const body = document.createElement("span");
    body.className = "metrics-log-text";
    body.textContent = text;
    if (title) body.title = title;
    const tail = document.createElement("span");
    tail.className = "metrics-log-right";
    tail.textContent = right;
    if (rightTitle) tail.title = rightTitle;
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ui-icon-button ui-icon-button--ghost ui-icon-button--xs metrics-copy";
    copyButton.textContent = COPY_GLYPH;
    // Say what it copies: the argument for a tool row, the stats line for a prompt.
    const copyLabel =
      kind === "tool"
        ? translate("metrics.copyCommand", "Copy command / path")
        : kind === "compaction"
          ? translate("metrics.copyCompaction", "Copy compaction line")
          : translate("metrics.copyStats", "Copy prompt stats");
    copyButton.title = copyLabel;
    copyButton.setAttribute("aria-label", copyLabel);
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.#copyLine(copyButton, copy || row.textContent || "");
    });
    copyButton.addEventListener("mouseenter", () => {
      copyButton.title = copyTitle || translate("metrics.copy", "Copy this line");
    });
    row.append(time, mark, body, tail, copyButton);
    return row;
  }

  /** Clipboard with a same-page fallback; the glyph answers so it is obvious.
   * @param {HTMLButtonElement} button
   * @param {string} text
   */
  async #copyLine(button, text) {
    this.#copyHoldUntil = Date.now() + 1400;
    const feedback = () => {
      button.textContent = "✓";
      button.classList.add("copied");
      setTimeout(() => {
        button.textContent = COPY_GLYPH;
        button.classList.remove("copied");
      }, 1200);
    };
    try {
      await copyText(text);
      feedback();
    } catch {
      /* clipboard permission denied */
    }
  }

  /** @param {MetricsLogItem[] | null | undefined} items */
  #renderLog(items) {
    const els = this.#els;
    if (!els) return;
    const rows = Array.isArray(items) ? items : [];
    const signature = rows
      .map((item) =>
        item.kind === "compaction"
          ? `c${item.compaction.id}:${item.compaction.status}:${Math.round(
              (item.compaction.durationMs || 0) / 500,
            )}:${item.compaction.before}:${item.compaction.after}`
          : `${item.prompt.id}:${item.prompt.active ? 1 : 0}:${Math.round((item.prompt.durationMs || 0) / 500)}:${item.prompt.outputTokens}` +
            `:${item.prompt.toolCount}:${(item.prompt.tools || [])
              .map((tool) => `${tool.status}${Math.round((tool.durationMs || 0) / 250)}`)
              .join(",")}`,
      )
      .join("|");
    if (signature === this.#lastLogSignature) return;
    // While a copy acknowledgement is showing, keep the rows as they are: the
    // streaming prompt re-renders many times a second and would otherwise
    // replace the button mid-acknowledgement.
    if (Date.now() < this.#copyHoldUntil) return;
    this.#lastLogSignature = signature;

    const list = els.list;
    list.replaceChildren();
    if (!rows.length) {
      list.append(
        this.#logRow({
          kind: "empty",
          glyph: "",
          text: translate("metrics.noPrompts", "No prompts captured yet this session"),
          right: "",
        }),
      );
      return;
    }
    for (const item of rows) {
      if (item.kind === "compaction") {
        list.append(this.#compactionRow(item.compaction));
        continue;
      }
      const prompt = item.prompt;
      /** @type {MetricsEngineView} */
      const engine = prompt.engine || {};
      const calls = prompt.callOutputs || [];
      const parts = [
        `out ${fmtInt(prompt.outputTokens)}`,
        `prompt ${fmtInt(prompt.inputTokens)}`,
        `${fmtTps(prompt.decodeTps)} t/s`,
      ];
      if (calls.length > 1) parts.push(`${fmtInt(calls.length)} calls`);
      if (engine.meanItlMs) parts.push(`TPOT ${fmtMs(engine.meanItlMs)}`);
      if (prompt.retries) parts.push(`retry ${prompt.retries}`);
      if (prompt.compactions) parts.push(`compact ${prompt.compactions}`);
      list.append(
        this.#logRow({
          kind: "prompt",
          state: prompt.active ? PHASE_STATES[prompt.phase || ""] || "working" : "done",
          at: prompt.startedAt,
          glyph: prompt.active ? "◐" : "▪",
          text: `P${prompt.id}  ${parts.join("  ·  ")}`,
          right: fmtMs(prompt.durationMs),
          rightTitle: translate("metrics.turnDuration", "Prompt wall time"),
          copy: [
            `prompt P${prompt.id}`,
            clockTime(prompt.startedAt),
            ...parts,
            engine.meanQueueMs ? `queue ${fmtMs(engine.meanQueueMs)}` : "",
            engine.meanPrefillMs ? `prefill ${fmtMs(engine.meanPrefillMs)}` : "",
            engine.tokensPerStep ? `accept len ${engine.tokensPerStep.toFixed(2)}` : "",
            `turn ${fmtMs(prompt.durationMs)}`,
          ]
            .filter(Boolean)
            .join(" · "),
          title: [
            `prompt ${prompt.id}`,
            calls.length > 1 ? `out per model call: ${calls.map(fmtInt).join(", ")}` : "",
            `${fmtInt(prompt.reasoningTokens)} thinking tokens`,
            `cached ${fmtInt(prompt.cacheReadTokens)}`,
            prompt.cost ? `cost $${prompt.cost.toFixed(4)}` : "",
            `${fmtInt(prompt.textChars)} text chars`,
            `${fmtInt(prompt.thinkingChars)} thinking chars`,
            prompt.genMs ? `generating ${fmtMs(prompt.genMs)}` : "",
            engine.genTokens ? `engine ${fmtInt(engine.genTokens)} tokens decoded` : "",
            engine.specAcceptPct ? `spec accept ${fmtPct(engine.specAcceptPct)}` : "",
            engine.kvPeakPct ? `KV peak ${engine.kvPeakPct.toFixed(1)}%` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        }),
      );
      const shownTools = prompt.tools || [];
      const hiddenTools = Math.max(0, (prompt.toolCount || 0) - shownTools.length);
      if (hiddenTools > 0) {
        list.append(
          this.#logRow({
            kind: "tool",
            state: "",
            at: shownTools[0]?.startedAt,
            glyph: "…",
            text: `${fmtInt(hiddenTools)} ${translate("metrics.earlierTools", "earlier tool calls")}`,
            right: "",
          }),
        );
      }
      for (const tool of shownTools) {
        list.append(
          this.#logRow({
            kind: "tool",
            state: tool.status,
            at: tool.startedAt,
            glyph: TOOL_GLYPHS[tool.status || ""] || "•",
            text: `${tool.toolName}  ${tool.label || "—"}`,
            title: tool.title || tool.label || "",
            right: fmtMs(tool.durationMs),
            // A tool row copies its argument alone, so it can be pasted into a
            // terminal or opened as a path; the summary line stays in the tooltip.
            copy: tool.title || tool.label || "",
            copyTitle: [
              `tool ${tool.toolName}`,
              tool.status,
              clockTime(tool.startedAt),
              fmtMs(tool.durationMs),
              tool.title || tool.label || "",
            ]
              .filter(Boolean)
              .join(" · "),
          }),
        );
      }
    }
  }

  /**
   * One compaction row: in progress it says so, once finished it carries the
   * before/after context sizes. `after` stays "…" until pi's next request proves
   * the new size, because pi's event only reports `tokensBefore`.
   * @param {MetricsCompactionView} view
   */
  #compactionRow(view) {
    // pi mirrors the status into `reason` (`"aborted"`, `"error"`), and "auto" is
    // the default, so only a reason that adds information is worth printing.
    const informative =
      Boolean(view.reason) &&
      view.reason !== "auto" &&
      view.reason !== view.status &&
      !["aborted", "error"].includes(view.reason || "");
    const reason = informative ? ` (${view.reason})` : "";
    /** @type {Record<string, string>} */
    const verbs = {
      running: translate("metrics.compactingRow", "compacting"),
      ok: translate("metrics.compactedRow", "compacted"),
      retrying: translate("metrics.compactionRetrying", "compaction retrying"),
      aborted: translate("metrics.compactionAborted", "compaction aborted"),
      error: translate("metrics.compactionFailed", "compaction failed"),
    };
    const verb = verbs[view.status || ""] || translate("metrics.compactionRow", "compaction");
    const head =
      view.status === "ok"
        ? `${verb}${reason} ${fmtInt(view.before)} → ${view.after ? fmtInt(view.after) : "…"}`
        : view.before
          ? `${verb}${reason} ${fmtInt(view.before)} tokens`
          : `${verb}${reason}`;
    const parts = [];
    if (view.status === "ok" && view.saved) parts.push(`−${fmtInt(view.saved)}`);
    if (view.summaryTokens) parts.push(`summary ${fmtInt(view.summaryTokens)}`);
    if (view.error && view.error !== "aborted") parts.push(view.error);
    if (view.stale) parts.push(translate("metrics.compactionStale", "no end event seen"));
    const text = parts.length ? `${head}  ·  ${parts.join("  ·  ")}` : head;
    return this.#logRow({
      kind: "compaction",
      state: view.status,
      at: view.startedAt,
      glyph: COMPACTION_GLYPHS[view.status || ""] || "↺",
      text,
      right: fmtMs(view.durationMs),
      rightTitle: translate("metrics.compactionDuration", "Compaction wall time"),
      copy: [
        informative ? `compaction ${view.reason}` : "compaction",
        view.status,
        clockTime(view.startedAt),
        view.before ? `${fmtInt(view.before)} → ${view.after ? fmtInt(view.after) : "…"}` : "",
        view.saved ? `−${fmtInt(view.saved)}` : "",
        view.summaryTokens ? `summary ${fmtInt(view.summaryTokens)}` : "",
        `took ${fmtMs(view.durationMs)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      title: [
        `compaction ${view.id}${view.reason ? ` · ${view.reason}` : ""}`,
        view.before ? `before ${fmtInt(view.before)} tokens` : "",
        view.status === "ok"
          ? view.after
            ? `after ${fmtInt(view.after)} tokens`
            : translate("metrics.compactionPendingAfter", "new size waits for the next request")
          : "",
        view.afterAt ? `new size measured ${clockTime(view.afterAt)}` : "",
        view.status === "aborted" || view.status === "error" || view.status === "retrying"
          ? translate("metrics.compactionNoRewrite", "context left untouched")
          : "",
        view.summaryTokens ? `summary ${fmtInt(view.summaryTokens)} tokens` : "",
        view.turnId ? `inside prompt P${view.turnId}` : "while idle",
        view.error && view.error !== "aborted" ? view.error : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
}
