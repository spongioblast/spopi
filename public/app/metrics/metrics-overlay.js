// ABOUTME: Cockpit: Pi's turn telemetry for any model, plus model-server counters when its /metrics answers.
// ABOUTME: Owns open state, the live tick, and render order; scraping, view rows, and elements live in sibling modules.

import { uiStore } from "../storage/ui-store.js";
import { fmtMs, fmtTps, num, phaseLabel, resolveMetricsUrl, translate } from "./metrics-format.js";
import { createMetricsModel } from "./metrics-model.js";
import {
  buildMetricsOverlay,
  copyLogLine,
  createLogRow,
  statChips,
} from "./metrics-overlay-paint.js";
import { logRowSpecs, logSignature, PHASE_STATES } from "./metrics-overlay-view.js";
import { createMetricsScraper } from "./metrics-scraper.js";
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
 * @typedef {import("./metrics-overlay-view.js").MetricsModelInfo} MetricsModelInfo
 * @typedef {import("./metrics-overlay-view.js").MetricsSnapshot} MetricsSnapshot
 * @typedef {import("./metrics-overlay-view.js").MetricsLogItem} MetricsLogItem
 * @typedef {import("./metrics-overlay-view.js").MetricsPromptView} MetricsPromptView
 * @typedef {import("./metrics-overlay-view.js").MetricsServerView} MetricsServerView
 * @typedef {import("./metrics-overlay-paint.js").MetricsOverlayEls} MetricsOverlayEls
 * @typedef {import("./metrics-scraper.js").MetricsFetch} MetricsFetch
 * @typedef {import("./metrics-scraper.js").MetricsScrapeResult} MetricsScrapeResult
 * @typedef {import("./metrics-scraper.js").MetricsScrapeFn} MetricsScrapeFn
 * @typedef {import("./metrics-scraper.js").MetricsScraper} MetricsScraper
 *
 * @typedef {{
 *   onRuntimeEvent: (event: unknown, at?: number) => void,
 *   recordServerScrape: (text: string, meta?: { at?: number, latencyMs?: number }) => unknown,
 *   recordServerFailure: (error: unknown, meta?: { at?: number, latencyMs?: number }) => void,
 *   snapshot: (at?: number) => MetricsSnapshot,
 * }} MetricsModelApi
 */

const OPEN_TICK_MS = 250;
const URL_KEY = "ui.metrics.url";

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
  /** The user's metrics URL; empty means `/metrics` at the current model's server. */
  /** @type {string} */
  #metricsUrl;
  /** @type {MetricsScraper} */
  #scraper;
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
  /** @type {string} */
  #lastLogSignature = "";
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
    this.#metricsUrl = resolveMetricsUrl(readStored(storage, URL_KEY), metricsUrl);
    this.#scraper = createMetricsScraper({
      model: this.#model,
      getModelInfo,
      getMetricsUrl: () => this.#metricsUrl,
      isOpen: () => this.#open,
      fetchImpl:
        fetchImpl ||
        ((url, init) => {
          return globalThis.fetch(url, init);
        }),
      scrapeFn,
    });
    this.#tickMs = tickMs;
    this.#docked = true;
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
    void this.#scraper.scrape();
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
    this.#scraper.scrapeForEvent(event);
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
    void this.#scraper.scrape();
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
    const { root, els } = buildMetricsOverlay(container, {
      docked: this.#docked,
      onThinkingClick: () => {
        this.#thinkingBudget = nextThinkingBudget(this.#thinkingBudget);
        this.#paintThinking();
        const info = this.#getModelInfo?.() || {};
        const onThinkingBudget = this.#onThinkingBudget;
        onThinkingBudget?.(this.#thinkingBudget, {
          level: info.thinkingLevel || "high",
        });
      },
    });
    this.#root = root;
    this.#els = els;

    this.#onKeyDown = (event) => {
      if (this.#open && event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
    };
    document.addEventListener("keydown", this.#onKeyDown);
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
      void this.#scraper.scrape();
      this.#render();
    }, this.#tickMs);
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
    const session = snapshot.session || {};
    const health = snapshot.health || {};
    // Latency breakdown and KV cache come only from the model server's own
    // counters; without them the Cockpit shows what Pi reports for every model.
    const serverLive = health.ok === true;
    els.stats.replaceChildren(...statChips(snapshot, { docked: this.#docked, serverLive }));
    els.kvRow.hidden = !serverLive;

    /** @type {MetricsServerView} */
    const server = snapshot.server || {};
    const kv = Math.max(0, Math.min(100, num(server.kvCachePct)));
    const kvPeak = Math.max(0, Math.min(100, Math.max(kv, num(prompt.engine?.kvPeakPct))));
    els.kvFill.style.width = `${kv}%`;
    els.kvFill.classList.toggle("hot", kv > 80);
    els.kvText.textContent = `${translate("metrics.kvCache", "KV cache {pct}%", { pct: kv ? kv.toFixed(1) : "0" })}${kvPeak > kv ? ` · ${translate("metrics.kvPeak", "peak {pct}%", { pct: kvPeak.toFixed(1) })}` : ""}`;

    this.#renderLog(snapshot.log);

    const age = health.lastOkAt ? Math.max(0, Date.now() - health.lastOkAt) : 0;
    const turns = session.turns || 0;
    const avg = snapshot.avgDecodeTps ? ` · avg ${fmtTps(snapshot.avgDecodeTps)} t/s` : "";
    const sessionPart = turns ? ` · ${turns} prompt${turns === 1 ? "" : "s"}${avg}` : "";
    // Strip only the scheme. Dropping the host too (an earlier draft) left a
    // bare ":8000/metrics" in the footer, which reads as a broken string.
    const scraped = this.#scraper.scrapedUrl || this.#metricsUrl;
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

  /** @param {MetricsLogItem[] | null | undefined} items */
  #renderLog(items) {
    const els = this.#els;
    if (!els) return;
    const rows = Array.isArray(items) ? items : [];
    const signature = logSignature(rows);
    if (signature === this.#lastLogSignature) return;
    // While a copy acknowledgement is showing, keep the rows as they are: the
    // streaming prompt re-renders many times a second and would otherwise
    // replace the button mid-acknowledgement.
    if (Date.now() < this.#copyHoldUntil) return;
    this.#lastLogSignature = signature;
    const onCopy = (/** @type {HTMLButtonElement} */ button, /** @type {string} */ text) => {
      this.#copyHoldUntil = Date.now() + 1400;
      void copyLogLine(button, text);
    };
    els.list.replaceChildren(...logRowSpecs(rows).map((spec) => createLogRow(spec, onCopy)));
  }
}
