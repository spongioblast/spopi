// ABOUTME: Scrapes the model server's /metrics (through the host or fetch) into the metrics model.
// ABOUTME: Decides when a runtime event is worth a scrape while the card is closed. No DOM, no timer.

/**
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
 *   recordServerScrape: (text: string, meta?: { at?: number, latencyMs?: number }) => unknown,
 *   recordServerFailure: (error: unknown, meta?: { at?: number, latencyMs?: number }) => void,
 * }} ScrapeSink
 *
 * @typedef {{
 *   scrape: () => Promise<void>,
 *   scrapeForEvent: (event: unknown) => void,
 *   readonly scrapedUrl: string,
 * }} MetricsScraper
 */

const SCRAPE_TIMEOUT_MS = 2500;
/** Floor between event-driven scrapes while the card is closed. */
const EVENT_SCRAPE_MIN_MS = 2000;

/**
 * The counters the Cockpit reads are vLLM's Prometheus names. A server without
 * them (LM Studio, Ollama, a cloud API) simply has no server panel.
 * @param {string} text
 */
function hasServerMetrics(text) {
  return /^vllm:/m.test(text);
}

/**
 * @param {{
 *   model: ScrapeSink,
 *   getModelInfo: (() => { baseUrl?: string } | null | undefined) | null,
 *   getMetricsUrl: () => string,
 *   isOpen: () => boolean,
 *   fetchImpl: MetricsFetch,
 *   scrapeFn: MetricsScrapeFn | null,
 * }} deps
 * @returns {MetricsScraper}
 */
export function createMetricsScraper({
  model,
  getModelInfo,
  getMetricsUrl,
  isOpen,
  fetchImpl,
  scrapeFn,
}) {
  let inFlight = false;
  /** The URL the last scrape actually read, for the footer. */
  let scrapedUrl = "";
  let lastEventScrapeAt = 0;

  async function scrape() {
    if (inFlight) return;
    if (typeof document !== "undefined" && document.hidden && !isOpen()) return;
    inFlight = true;
    const startedAt = Date.now();
    const metricsUrl = getMetricsUrl();
    /** @type {AbortController | null} */
    let controller = null;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    let timeout = 0;
    try {
      scrapedUrl = "";
      if (scrapeFn) {
        const info = getModelInfo?.() || {};
        const baseUrl = String(info.baseUrl || metricsUrl.replace(/\/metrics$/, ""));
        if (!baseUrl) throw new Error("no model server");
        const snapshot = await scrapeFn({ baseUrl, metricsUrl });
        scrapedUrl = snapshot?.metricsUrl || getMetricsUrl();
        const text = snapshot?.raw?.text || snapshot?.text || "";
        if (!text) throw new Error(snapshot?.raw?.error || "no answer");
        if (!hasServerMetrics(text)) throw new Error("no server metrics");
        model.recordServerScrape(text, { at: Date.now(), latencyMs: Date.now() - startedAt });
        return;
      }
      if (!metricsUrl) throw new Error("no model server");
      scrapedUrl = metricsUrl;
      /** @type {RequestInit} */
      const init = { cache: "no-store", redirect: "follow" };
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        init.signal = controller.signal;
        const abortController = controller;
        timeout = setTimeout(() => abortController.abort(), SCRAPE_TIMEOUT_MS);
      }
      const response = await fetchImpl(metricsUrl, init);
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "?"}`);
      const text = await response.text();
      if (!hasServerMetrics(text)) throw new Error("no server metrics");
      model.recordServerScrape(text, { at: Date.now(), latencyMs: Date.now() - startedAt });
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error ? error.message : error;
      model.recordServerFailure(message || error, {
        at: Date.now(),
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      inFlight = false;
    }
  }

  /**
   * Keep per-prompt engine stats complete even while the card is closed by
   * scraping the moments that matter instead of polling: once when a prompt
   * starts, throttled as its tools finish, and once when it ends. Two scrapes
   * already make the counters a true window over the whole prompt, so the
   * headline number stays the engine's own measurement rather than an estimate.
   * @param {unknown} event
   */
  function scrapeForEvent(event) {
    if (isOpen() || !event || typeof event !== "object") return;
    const now = Date.now();
    const fire = () => {
      lastEventScrapeAt = now;
      scrape();
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
    if (milestone && now - lastEventScrapeAt >= EVENT_SCRAPE_MIN_MS) fire();
  }

  return {
    scrape,
    scrapeForEvent,
    get scrapedUrl() {
      return scrapedUrl;
    },
  };
}
