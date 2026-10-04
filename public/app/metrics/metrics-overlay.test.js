// ABOUTME: Tests the docked Cockpit controls row.
// ABOUTME: Tests metrics-overlay.js.
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectCacheWarming } from "./cache-warming-control.js";
import { MetricsOverlay } from "./metrics-overlay.js";

/** @type {MetricsOverlay | null} */
let overlay = null;

afterEach(() => {
  overlay?.destroy();
  overlay = null;
  document.body.replaceChildren();
});

/**
 * @param {string} [mode]
 */
function configCallFor(mode = "streaming") {
  return vi.fn(async (op) => {
    if (op === "get_cache_warming") return { ok: true, data: { mode } };
    return { ok: true };
  });
}

/**
 * @param {ReturnType<typeof configCallFor>} configCall
 */
async function mountDocked(configCall) {
  await connectCacheWarming(configCall);
  const host = document.createElement("div");
  document.body.append(host);
  overlay = new MetricsOverlay({
    container: host,
    tickMs: 60_000,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    }),
  });
  return host;
}

describe("cockpit for any model server", () => {
  /** @param {{ text?: string, error?: string }} raw @param {Record<string, unknown>} info */
  function mountWith(raw, info) {
    const host = document.createElement("div");
    document.body.append(host);
    const scrapeFn = vi.fn(async () => ({ metricsUrl: "http://127.0.0.1:1234/metrics", raw }));
    overlay = new MetricsOverlay({
      container: host,
      tickMs: 60_000,
      storage: { getItem: () => null, setItem: () => {} },
      getModelInfo: () => info,
      scrapeFn,
    });
    return { host, scrapeFn };
  }

  const chipNames = (host) =>
    [...host.querySelectorAll(".metrics-chip b")].map((node) => node.textContent);

  it("shows only Pi's numbers when the server has no vLLM metrics", async () => {
    const { host, scrapeFn } = mountWith(
      { error: "HTTP 404" },
      { id: "qwen3-8b", baseUrl: "http://127.0.0.1:1234/v1" },
    );
    await vi.waitFor(() => expect(scrapeFn).toHaveBeenCalled());
    await vi.waitFor(() => expect(overlay.model.snapshot().health?.ok).toBe(false));
    overlay.close();
    overlay.open();
    expect(host.querySelector(".metrics-foot")?.textContent).toContain("No model-server metrics");
    expect(chipNames(host)).toContain("tok/s");
    expect(chipNames(host)).not.toContain("TPOT");
    expect(host.querySelector(".metrics-kv")?.hidden).toBe(true);
    expect(scrapeFn).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:1234/v1", metricsUrl: "" });
  });

  it("adds the server's latency and KV cache when vLLM metrics come back", async () => {
    const text = "# TYPE vllm:num_requests_running gauge\nvllm:num_requests_running 0\n";
    const { host } = mountWith({ text }, { id: "qwen", baseUrl: "http://127.0.0.1:8000/v1" });
    await vi.waitFor(() => expect(overlay.model.snapshot().health?.ok).toBe(true));
    overlay.close();
    overlay.open();
    expect(chipNames(host)).toContain("TPOT");
    expect(host.querySelector(".metrics-kv")?.hidden).toBe(false);
  });

  it("shows the thinking budget only for a model with Pi's budget field", () => {
    const { host } = mountWith({ error: "x" }, { id: "claude", baseUrl: "https://api.x/v1" });
    expect(host.querySelector(".metrics-thinking")?.hidden).toBe(true);
    overlay.destroy();
    const second = mountWith(
      { error: "x" },
      { id: "qwen", provider: "anything", thinkingBudgetField: "thinking_token_budget" },
    );
    expect(second.host.querySelector(".metrics-thinking")?.hidden).toBe(false);
  });
});

describe("docked cockpit", () => {
  it("keeps the stats row free of form controls", async () => {
    const host = await mountDocked(configCallFor());
    const stats = host.querySelector(".metrics-chip-row");
    expect(stats?.querySelector("select, input, textarea, button")).toBeNull();
    const buttons = [...host.querySelectorAll(".metrics-controls button[data-mode]")];
    expect(buttons.map((button) => button.dataset.mode)).toEqual(["off", "streaming", "idle"]);
    expect(buttons.every((button) => button.classList.contains("ui-button"))).toBe(true);
    expect(buttons.every((button) => button.classList.contains("ui-button--xs"))).toBe(true);
    expect(buttons.every((button) => button.getAttribute("title"))).toBe(true);
    expect(host.querySelector(".metrics-controls .metrics-thinking")).toBeTruthy();
    expect(host.querySelector(".metrics-foot-row .metrics-thinking")).toBeNull();
  });

  it("sends set_cache_warming when a segment is clicked", async () => {
    const configCall = configCallFor("streaming");
    const host = await mountDocked(configCall);
    const idle = host.querySelector('.metrics-controls button[data-mode="idle"]');
    expect(idle?.getAttribute("aria-pressed")).toBe("false");
    expect(
      host
        .querySelector('.metrics-controls button[data-mode="streaming"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    idle?.click();
    expect(configCall).toHaveBeenCalledWith("set_cache_warming", { mode: "idle" });
    expect(idle?.getAttribute("aria-pressed")).toBe("true");
    expect(
      host
        .querySelector('.metrics-controls button[data-mode="streaming"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
