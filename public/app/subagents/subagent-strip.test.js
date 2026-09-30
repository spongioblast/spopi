// ABOUTME: Tests the subagent strip above the composer.
// ABOUTME: Hidden without runs; one row per child with Open, and Stop only while it runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentStrip } from "./subagent-strip.js";

/** @type {HTMLElement} */
let container;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement("div");
  container.append(document.createElement("form"));
  document.body.append(container);
});

afterEach(() => vi.useRealTimers());

/** @param {Partial<import("./subagent-feed.js").SubagentNode>} fields */
const node = (fields) => ({
  id: "run-1",
  label: "scout",
  state: "running",
  children: [],
  ...fields,
});

describe("SubagentStrip", () => {
  it("sits above the composer and stays hidden until a run is reported", () => {
    const strip = new SubagentStrip({
      container,
      t: (key) => key,
      onOpen: vi.fn(),
      onStop: vi.fn(),
    });
    const section = container.firstElementChild;
    expect(section?.classList.contains("subagent-strip")).toBe(true);
    expect(section?.nextElementSibling?.tagName).toBe("FORM");
    expect(section?.classList.contains("hidden")).toBe(true);
    strip.setRuns([node({ startedAt: 0, toolCount: 3, currentTool: "bash" })]);
    expect(section?.classList.contains("hidden")).toBe(false);
    strip.clear();
    expect(section?.classList.contains("hidden")).toBe(true);
  });

  it("opens and stops a running child, and offers no stop once it finished", () => {
    const onOpen = vi.fn();
    const onStop = vi.fn();
    const strip = new SubagentStrip({
      container,
      t: (key) => key,
      onOpen,
      onStop,
      now: () => 66_000,
    });
    strip.setRuns([
      node({
        startedAt: 1_000,
        toolCount: 3,
        currentTool: "bash",
        children: [node({ id: "step:0" })],
      }),
    ]);
    const row = container.querySelector(".subagent-row");
    expect(row?.textContent).toContain("scout");
    expect(row?.querySelector(".subagent-meta")?.textContent).toBe(
      "subagents.state.running · 1m 05s · subagents.tools.other · bash",
    );
    row?.querySelector(".subagent-open")?.dispatchEvent(new MouseEvent("click"));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", childId: "step:0" }),
    );
    row?.querySelector(".subagent-stop")?.dispatchEvent(new MouseEvent("click"));
    expect(onStop).toHaveBeenCalledWith("run-1", undefined);

    strip.setRuns([node({ state: "complete", startedAt: 1_000, endedAt: 5_000 })]);
    expect(container.querySelector(".subagent-stop")).toBeNull();
    expect(container.querySelector(".subagent-meta")?.textContent).toBe(
      "subagents.state.complete · 4.0s",
    );
  });

  it("lists each child of a parallel run and stops that child", () => {
    const onStop = vi.fn();
    const strip = new SubagentStrip({ container, t: (key) => key, onOpen: vi.fn(), onStop });
    strip.setRuns([
      node({
        children: [
          node({ id: "step:0", label: "reviewer" }),
          node({ id: "step:1", label: "tests" }),
        ],
      }),
    ]);
    const rows = [...container.querySelectorAll(".subagent-row")];
    expect(rows.map((row) => row.querySelector(".subagent-name")?.textContent)).toEqual([
      "reviewer",
      "tests",
    ]);
    rows[1].querySelector(".subagent-stop")?.dispatchEvent(new MouseEvent("click"));
    expect(onStop).toHaveBeenCalledWith("run-1", "step:1");
  });
});
