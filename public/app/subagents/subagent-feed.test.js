// ABOUTME: Tests reading pi-subagents' run snapshots and inspect replies.
// ABOUTME: Also the stop, steer, and inspect commands sent back as slash text.
import { describe, expect, it } from "vitest";
import {
  inspectCommand,
  isLive,
  isSubagentWidget,
  openTargets,
  parseInspect,
  parseRuns,
  steerCommand,
  stopCommand,
} from "./subagent-feed.js";

const snapshot = {
  kind: "pi-subagents.async-status-snapshot",
  version: 1,
  runs: [
    {
      id: "run-1",
      kind: "subagent",
      label: "scout",
      state: "running",
      startedAt: 1000,
      activity: { toolCount: 12, currentTool: "bash" },
      children: [{ id: "step:0", kind: "step", label: "scout", state: "running" }],
    },
  ],
};

describe("subagent feed", () => {
  it("recognizes only the two pi-subagents widget keys", () => {
    expect(isSubagentWidget({ method: "setWidget", widgetKey: "subagent-async" })).toBe(true);
    expect(isSubagentWidget({ method: "setWidget", widgetKey: "subagent-inspect" })).toBe(true);
    expect(isSubagentWidget({ method: "setWidget", widgetKey: "rpiv-todos" })).toBe(false);
  });

  it("reads runs from the snapshot line and treats a removed widget as no runs", () => {
    const runs = parseRuns([`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(snapshot)}`]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "run-1",
      label: "scout",
      state: "running",
      currentTool: "bash",
      toolCount: 12,
    });
    expect(runs[0].children[0].id).toBe("step:0");
    expect(parseRuns(undefined)).toEqual([]);
    expect(parseRuns(["not json"])).toEqual([]);
  });

  it("reads an inspect reply and keeps only messages with text", () => {
    const reply = parseInspect([
      `PI_SUBAGENT_INSPECT_JSON:${JSON.stringify({
        kind: "pi-subagents.inspect-reply",
        requestId: "r1",
        status: "complete",
        messages: [{ role: "assistant", kind: "text", text: "done" }, { role: "x" }],
        finalOutput: "Single-file repo.",
      })}`,
    ]);
    expect(reply).toMatchObject({ requestId: "r1", status: "complete" });
    expect(reply?.messages).toHaveLength(1);
    expect(reply?.finalOutput).toBe("Single-file repo.");
  });

  it("opens a single run through its step, and a parallel run per child", () => {
    const [single] = parseRuns([`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(snapshot)}`]);
    const [target] = openTargets(single);
    expect(target).toMatchObject({ runId: "run-1", childId: "step:0" });
    expect(target.steerChild).toBeUndefined();
    const parallel = {
      ...single,
      children: [
        { ...single.children[0], id: "step:0" },
        { ...single.children[0], id: "step:1" },
      ],
    };
    expect(openTargets(parallel).map((target) => target.steerChild)).toEqual(["step:0", "step:1"]);
  });

  it("builds the pi-subagents commands", () => {
    expect(stopCommand("run-1")).toBe("/subagents-stop run-1");
    expect(stopCommand("run-1", "step:1")).toBe("/subagents-stop run-1 step:1");
    expect(steerCommand("run-1", undefined, "  look at\nauth  ")).toBe(
      "/subagents-steer run-1 look at auth",
    );
    expect(steerCommand("run-1", "step:1", "go")).toBe("/subagents-steer run-1 --child step:1 go");
    expect(steerCommand("run-1", undefined, "   ")).toBe("");
    expect(inspectCommand("r1", "run-1", "step:0", 40)).toBe(
      "/subagents-inspect-rpc r1 run-1 step:0 --lines 40",
    );
    expect(isLive("running")).toBe(true);
    expect(isLive("complete")).toBe(false);
  });
});
