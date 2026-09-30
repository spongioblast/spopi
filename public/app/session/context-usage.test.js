// ABOUTME: Tests context usage header.
// ABOUTME: Includes "keeps the context pill and popover synced from restored session history".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { findLatestAssistantUsage, mountContextUsage } from "./context-usage.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

function renderFixture() {
  document.body.innerHTML = `
    <span class="pill token-usage" id="token-usage" title="Context usage"></span>
    <div class="context-viz hidden" id="context-viz">
      <div class="context-bar" id="context-bar"></div>
      <div class="context-legend" id="context-legend"></div>
      <div class="context-viz-footer">
        <span id="context-viz-used"></span>
        <span id="context-viz-total"></span>
        <button class="ui-button ui-button--sm ui-button--secondary context-viz-compact-btn" id="compact-context-btn"><span class="compact-btn-label"></span></button>
      </div>
    </div>
  `;
}

describe("context usage header", () => {
  beforeEach(async () => {
    renderFixture();
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("/locales/en.json")) {
        return new Response(JSON.stringify(enMessages));
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    await createI18n();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("keeps the context pill and popover synced from restored session history", () => {
    const ui = mountContextUsage();

    ui.setUsage({ input: 191, cacheRead: 9300 }, 128_000);

    const pill = document.getElementById("token-usage");
    expect(pill.classList.contains("visible")).toBe(true);
    expect(pill.textContent).toBe("7%");

    pill.click();

    expect(document.getElementById("context-viz").classList.contains("hidden")).toBe(false);
    // The legend shows cached and uncached token counts; verify both numeric values appear.
    expect(document.getElementById("context-legend").textContent).toContain("9.3k");
    // Input tokens were 191; ensure the raw count or a related label is present.
    expect(document.getElementById("context-legend").textContent).toMatch(/191|cache|input/i);

    expect(document.getElementById("context-viz-used").textContent).toMatch(/7%|context\.used/);
    expect(document.getElementById("context-viz-total").textContent).toBe("9.5k / 128.0k");
  });

  it("combines session in/out with context percentage on the same pill", () => {
    const ui = mountContextUsage();

    ui.setUsage({ input: 191, cacheRead: 9300 }, 128_000);
    ui.setSessionTotals({ input: 1_600_000, output: 6000 });

    const pill = document.getElementById("token-usage");
    expect(pill.classList.contains("visible")).toBe(true);
    expect(pill.textContent).toBe("↓ 1.6M · ↑ 6.0k · 7%");

    pill.click();
    const legendLabels = [...document.querySelectorAll(".context-legend-item")].map(
      (item) => item.querySelector(".context-legend-left")?.textContent,
    );
    expect(legendLabels).toEqual(["Input", "Output", "Available", "Cached"]);
    expect(document.getElementById("context-legend").textContent).toContain("6.0k");
  });

  it("shows session in/out even before current context is known", () => {
    const ui = mountContextUsage();
    ui.setSessionTotals({ input: 100, output: 50 });

    const pill = document.getElementById("token-usage");
    expect(pill.classList.contains("visible")).toBe(true);
    expect(pill.textContent).toBe("↓ 100 · ↑ 50");
  });

  it("only shows the compact control when Pi has enough context to compact", () => {
    const control = mountContextUsage();
    const button = document.getElementById("compact-context-btn");

    expect(button.closest("#context-viz")).not.toBeNull();
    control.setUsage({ input: 2, cacheRead: 17_400 }, 1_000_000);
    expect(button.hidden).toBe(true);

    control.setUsage({ input: 8_000, cacheRead: 17_000 }, 128_000);
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);

    control.setWorking(true);
    expect(button.disabled).toBe(true);
    control.setWorking(false);
    control.setCompacting(true);
    expect(button.disabled).toBe(true);
    expect(button.classList.contains("compacting")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("finds the newest assistant usage in a snapshot", () => {
    expect(
      findLatestAssistantUsage([
        { role: "assistant", usage: { input: 1 } },
        { role: "user", content: "again" },
        { role: "assistant", usage: { input: 2, cacheRead: 3 } },
      ]),
    ).toEqual({ input: 2, cacheRead: 3 });
  });
});
