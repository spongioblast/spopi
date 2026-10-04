// ABOUTME: Pins the header session-aggregate lifecycle: totals come only from get_session_stats.
// ABOUTME: Re-hydrating replaces the totals, and a reset clears them for a new session.
// @vitest-environment jsdom
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
    expect(Object.keys(bar).sort()).toEqual(["hydrateSessionStats", "reset"]);
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

  it("replaces the totals with a newer get_session_stats for the same session", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30 },
      cost: { total: 0.02 },
    });
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 140, output: 70, cacheRead: 40 },
      cost: { total: 0.03 },
    });
    expect(onTotalsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: 140, output: 70, cacheRead: 40 }),
    );
    expect(document.getElementById("session-cost").textContent).toContain("0.03");
  });

  it("clears the aggregate on reset for a new session", () => {
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

  it("ignores stats without a session file", () => {
    const { bar, onTotalsChange } = makeBar();
    expect(bar.hydrateSessionStats({ tokens: { input: 40 }, cost: { total: 0.01 } })).toBe(false);
    expect(onTotalsChange).not.toHaveBeenCalled();
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

  it("ignores stats for a different session than the hydrated one", () => {
    const { bar, onTotalsChange } = makeBar();
    bar.hydrateSessionStats({
      sessionFile: "/s/a.jsonl",
      tokens: { input: 100, output: 50, cacheRead: 30, cacheWrite: 5, total: 185 },
      cost: { total: 0.02 },
    });
    expect(
      bar.hydrateSessionStats({
        sessionFile: "/s/other.jsonl",
        tokens: { input: 1, output: 1 },
        cost: { total: 9 },
      }),
    ).toBe(false);
    expect(onTotalsChange).toHaveBeenLastCalledWith(expect.objectContaining({ output: 50 }));
  });
});
