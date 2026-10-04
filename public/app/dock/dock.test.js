// ABOUTME: Tests createDockHost.
// ABOUTME: Includes "adopts the terminal".
import { afterEach, describe, expect, it } from "vitest";
import { createDockHost, dockStatusFromSnapshot, renderDockStatus } from "./dock.js";

afterEach(() => {
  document.body.textContent = "";
});

describe("createDockHost", () => {
  it("adopts the terminal's + into the dock strip and shows it only on the Terminal tab", () => {
    const pane = document.createElement("div");
    const terminal = document.createElement("section");
    terminal.id = "terminal-panel";
    const plus = document.createElement("button");
    plus.dataset.terminalNewTab = "";
    terminal.append(plus);
    document.body.append(pane, terminal);

    const dock = createDockHost(pane, { initialTab: "terminal", terminal });
    expect(dock.dataset.terminalTheme).toBe("system");
    expect(dock.querySelector(".spopi-dock-tabs")?.getAttribute("role")).toBe("tablist");
    const terminalTab = dock.querySelector("#spopi-dock-tab-terminal");
    expect(terminalTab?.getAttribute("role")).toBe("tab");
    expect(terminalTab?.getAttribute("aria-selected")).toBe("true");
    expect(dock.querySelector("#spopi-dock-terminal")?.getAttribute("role")).toBe("tabpanel");

    const actions = dock.querySelector("#spopi-dock-actions");
    expect(actions.contains(plus)).toBe(true);
    expect(plus.hidden).toBe(false);
    dock.setTab("cockpit");
    expect(plus.hidden).toBe(true);
    dock.setTab("terminal");
    expect(plus.hidden).toBe(false);
  });
});

describe("dockStatusFromSnapshot", () => {
  it("maps engine rates onto the status strip fields", () => {
    expect(
      dockStatusFromSnapshot({
        prompt: { decodeTps: 41.2, engine: { meanTtftMs: 180 } },
        rates: { prefixHitPct: 92, cacheHitPct: 10 },
        server: { kvCachePct: 33 },
      }),
    ).toEqual({
      tokPerSec: 41.2,
      ttftMs: 180,
      cachePct: 92,
      kvPct: 33,
    });
  });

  it("uses prompt cache share instead of cacheRead/input", () => {
    expect(
      dockStatusFromSnapshot({
        prompt: { inputTokens: 200, cacheReadTokens: 800, cacheSharePct: 80 },
      }).cachePct,
    ).toBe(80);
    expect(
      dockStatusFromSnapshot({
        prompt: { inputTokens: 0, cacheReadTokens: 0 },
      }).cachePct,
    ).toBeUndefined();
    expect(
      dockStatusFromSnapshot({
        prompt: { inputTokens: 0, cacheReadTokens: 100 },
      }).cachePct,
    ).toBe(100);
  });
});

describe("renderDockStatus", () => {
  it("renders Tier 0 chips", () => {
    const root = document.createElement("button");
    renderDockStatus(root, { tokPerSec: 40, ttftMs: 210, cachePct: 80, kvPct: 12 });
    expect(root.textContent).toContain("40 t/s");
    expect(root.textContent).toContain("210 ms");
    expect(root.textContent).toContain("KV 12%");
    expect(root.textContent).not.toContain("80%");
  });
});
