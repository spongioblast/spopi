// ABOUTME: Tests the session tree model against a fake runtime gateway.
// ABOUTME: Covers load, append, resync, a gap fallback, and getBranch.

import { describe, expect, it } from "vitest";
import {
  bindSessionTreeModel,
  branchMessages,
  createSessionTreeModel,
} from "./session-tree-host.js";

const user = {
  entry: {
    type: "message",
    id: "u1",
    parentId: null,
    message: { role: "user", content: "hello" },
  },
  children: [
    {
      entry: {
        type: "message",
        id: "a1",
        parentId: "u1",
        message: { role: "assistant", content: "hi" },
      },
      children: [],
    },
  ],
};

/**
 * @param {Array<{ cmd?: object, data?: object, error?: Error }>} steps
 */
function scripted(steps) {
  return async (cmd) => {
    const step = steps.shift();
    expect(cmd).toMatchObject(step?.cmd || {});
    if (step?.error) throw step.error;
    return { response: { data: step?.data } };
  };
}

describe("session tree model", () => {
  it("loads get_tree and returns the active branch", async () => {
    const model = bindSessionTreeModel({
      request: scripted([{ cmd: { type: "get_tree" }, data: { tree: [user], leafId: "a1" } }]),
      getTarget: () => ({ sessionId: "s" }),
    });
    const snapshot = await model.load();
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(["u1", "a1"]);
    expect(snapshot.leafId).toBe("a1");
    expect(model.getBranch("a1").map((entry) => entry.id)).toEqual(["u1", "a1"]);
    expect(branchMessages("a1")).toEqual([
      { role: "user", content: "hello", entryId: "u1" },
      { role: "assistant", content: "hi", entryId: "a1" },
    ]);
  });

  it("appends an entry and resyncs from the last id", async () => {
    const steps = [
      { cmd: { type: "get_tree" }, data: { tree: [user], leafId: "a1" } },
      {
        cmd: { type: "get_entries", since: "a2" },
        data: {
          entries: [{ type: "message", id: "a3", parentId: "a2", message: { role: "assistant" } }],
          leafId: "a3",
        },
      },
    ];
    const model = createSessionTreeModel({
      request: scripted(steps),
      getTarget: () => ({}),
    });
    await model.load();
    model.applyAppended({
      type: "message",
      id: "a2",
      parentId: "a1",
      message: { role: "user", content: "more" },
    });
    expect(model.snapshot().lastEntryId).toBe("a2");
    const next = await model.resync();
    expect(next.entries.map((entry) => entry.id)).toEqual(["u1", "a1", "a2", "a3"]);
    expect(next.leafId).toBe("a3");
    expect(model.getBranch().map((entry) => entry.id)).toEqual(["u1", "a1", "a2", "a3"]);
  });

  it("falls back to get_tree when the cursor or parent is unknown", async () => {
    const fresh = { tree: [user], leafId: "a1" };
    const model = createSessionTreeModel({
      request: scripted([
        { cmd: { type: "get_tree" }, data: fresh },
        { cmd: { type: "get_entries", since: "a1" }, error: new Error("missing") },
        { cmd: { type: "get_tree" }, data: fresh },
        {
          cmd: { type: "get_entries", since: "a1" },
          data: { entries: [{ type: "custom", id: "z", parentId: "missing" }], leafId: "a1" },
        },
        { cmd: { type: "get_tree" }, data: fresh },
      ]),
      getTarget: () => ({}),
    });
    await model.load();
    await model.resync();
    expect(model.snapshot().leafId).toBe("a1");
    await model.resync();
    expect(model.snapshot().entries.map((entry) => entry.id)).toEqual(["u1", "a1"]);
    const seen = [];
    const stop = model.subscribe((snapshot) => seen.push(snapshot.leafId));
    expect(seen).toEqual(["a1"]);
    model.dispose();
    stop();
  });
});
