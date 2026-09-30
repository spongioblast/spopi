// ABOUTME: Tests createHeaderStatusBar aggregate lifecycle.
// ABOUTME: Includes "starts empty and exposes the documented surface".
// @vitest-environment jsdom
// ABOUTME: Pins the header session-aggregate lifecycle: aggregate totals only hydrate
// ABOUTME: from authoritative stats and live completions; current context is independent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { createHeaderStatusBar } from "./header-status-bar.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  document.body.replaceChildren(
    Object.assign(document.createElement("span"), { id: "session-cost" }),
  );
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
});

function makeBar() {
  const onTotalsChange = vi.fn();
  const bar = createHeaderStatusBar({
    sessionCostEl: document.getElementById("session-cost"),
    t: (key, params) => {
      if (key === "usage.costSub") return `usage.costSub(${JSON.stringify(params)})`;
      return key;
    },
    onTotalsChange,
  });
  return { bar, onTotalsChange };
}

describe("createHeaderStatusBar aggregate lifecycle", () => {
  it("starts empty and exposes the documented surface", () => {
    const { bar, onTotalsChange } = makeBar();
    expect(typeof bar.applyLiveUsage).toBe("function");
    expect(typeof bar.hydrateSessionStats).toBe("function");
    expect(typeof bar.reset).toBe("function");
    expect(document.getElementById("session-cost").textContent).toBe("");
    expect(onTotalsChange).not.toHaveBeenCalled();
  });

  it("hydrates aggregate totals once and never from history replay", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30, cacheWrite: 5, total: 185 },
      cost: { total: 0.02 },
    });
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30, cacheWrite: 5, total: 185 },
      cost: { total: 0.02 },
    });
    expect(onTotalsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: 100, output: 50, cacheRead: 30 }),
    );
    expect(document.getElementById("session-cost").textContent).toContain("0.02");
  });

  it("accumulates only newly received live usage after hydration", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30, cacheWrite: 5, total: 185 },
      cost: { total: 0.02 },
    });
    expect(
      bar.applyLiveUsage(
        {
          input: 40,
          output: 20,
          cacheRead: 10,
          cacheWrite: 0,
          cost: { total: 0.01 },
        },
        { sessionFile: "/s/a.jsonl" },
      ),
    ).toBe(true);
    expect(onTotalsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: 140, output: 70, cacheRead: 40 }),
    );
    expect(document.getElementById("session-cost").textContent).toContain("0.03");
  });

  it("clears both aggregate and current context on reset for a new session", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30, cacheWrite: 5, total: 185 },
      cost: { total: 0.02 },
    });
    bar.reset();
    expect(onTotalsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: 0, output: 0, cost: 0 }),
    );
    expect(document.getElementById("session-cost").textContent).toBe("");
  });

  it("ignores live usage without a confirmed identity", () => {
    const { bar, onTotalsChange } = makeBar();
    expect(bar.applyLiveUsage({ input: 40, output: 20, cost: { total: 0.01 } })).toBe(false);
    expect(onTotalsChange).not.toHaveBeenCalled();

    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30 },
      cost: { total: 0.02 },
    });
    expect(
      bar.applyLiveUsage(
        { input: 40, output: 20, cost: { total: 0.01 } },
        { sessionFile: undefined },
      ),
    ).toBe(false);
    expect(onTotalsChange).toHaveBeenLastCalledWith(expect.objectContaining({ output: 50 }));
  });

  it("resets the aggregate to authoritative zero when tokens are null", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30 },
      cost: { total: 0.02 },
    });
    bar.hydrateSessionStats({ sessionFile: "/s/a.jsonl", tokens: null, cost: { total: 0 } });
    expect(onTotalsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: 0, output: 0, cost: 0 }),
    );
    expect(document.getElementById("session-cost").textContent).toBe("");
  });

  it("ignores a live usage that belongs to a different session than the hydrated one", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30, cacheWrite: 5, total: 185 },
      cost: { total: 0.02 },
    });
    bar.applyLiveUsage(
      { input: 40, output: 20, cacheRead: 10, cacheWrite: 0, cost: { total: 0.01 } },
      { sessionFile: "/s/other.jsonl" },
    );
    expect(onTotalsChange).toHaveBeenLastCalledWith(expect.objectContaining({ output: 50 }));
  });
});
