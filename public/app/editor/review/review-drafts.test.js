// ABOUTME: Tests the review draft list: add, remove, clear, and a stale load.
// ABOUTME: Each change asks the host to save. An older load cannot overwrite a newer one.

import { describe, expect, it, vi } from "vitest";
import { createReviewDrafts } from "./review-drafts.js";

describe("createReviewDrafts", () => {
  it("saves after add, remove, and clear", async () => {
    /** @type {unknown[]} */
    const saved = [];
    const drafts = createReviewDrafts({
      load: async () => [],
      save: async (_id, list) => {
        saved.push(list.map((/** @type {{ note?: string }} */ item) => item.note));
        return list;
      },
      onChange: () => {},
    });
    await drafts.useWorkspace("proj");
    await drafts.add({ scope: "turn", path: "a.js", hunk: { header: "@@" }, note: "one" });
    await drafts.add({ scope: "turn", path: "a.js", hunk: { header: "@@" }, note: "two" });
    await drafts.remove(drafts.list()[0].id);
    await drafts.clear();
    expect(saved).toEqual([["one"], ["one", "two"], ["two"], []]);
  });

  it("ignores a load that finishes after a newer workspace", async () => {
    /** @type {Array<(value: unknown) => void>} */
    const pending = [];
    const drafts = createReviewDrafts({
      load: () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
      save: async (_id, list) => list,
      onChange: () => {},
    });
    const first = drafts.useWorkspace("a");
    const second = drafts.useWorkspace("b");
    pending[1]?.([{ id: "b1", note: "bee" }]);
    await second;
    pending[0]?.([{ id: "a1", note: "old" }]);
    await first;
    expect(drafts.list().map((draft) => draft.id)).toEqual(["b1"]);
  });

  it("keeps a draft in memory when the save fails", async () => {
    const drafts = createReviewDrafts({
      load: async () => [],
      save: async () => {
        throw new Error("too large");
      },
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await drafts.useWorkspace("proj");
    await drafts.add({ path: "a.js", note: "kept" });
    expect(drafts.list().map((draft) => draft.note)).toEqual(["kept"]);
    quiet.mockRestore();
  });
});
