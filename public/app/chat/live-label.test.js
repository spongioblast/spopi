// ABOUTME: Tests the live strip label: running tool and target first, then the model phase.
// ABOUTME: A finished tool no longer names the strip.
import { describe, expect, it } from "vitest";
import { liveLabel } from "./live-label.js";

/** @param {object} step @param {string} [status] */
function stateWith(step, status = "pending") {
  return {
    transcript: {
      turns: [{ endedAt: null, work: { steps: [{ id: "t1", ...step }] } }],
      notes: [{ kind: "tool", id: "t1", status }],
    },
  };
}

describe("liveLabel", () => {
  it("names a running write by its file name", () => {
    const state = stateWith({ kind: "write", name: "write", args: { path: "D:/demo/app.js" } });
    expect(liveLabel(state, "tool")).toBe("Writing app.js");
  });

  it("names a running command by its first line", () => {
    const state = stateWith({
      kind: "bash",
      name: "bash",
      args: { command: "node --check app.js" },
    });
    expect(liveLabel(state, "tool")).toBe("Running node --check app.js");
  });

  it("falls back to the phase once the tool is done", () => {
    const state = stateWith({ kind: "read", name: "read", args: { path: "a.js" } }, "done");
    expect(liveLabel(state, "streaming")).toBe("Writing the answer");
    expect(liveLabel(state, "thinking")).toBe("Thinking");
    expect(liveLabel(null, "working")).toBe("Working");
  });
});
