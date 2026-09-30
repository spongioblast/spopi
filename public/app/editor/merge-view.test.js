// ABOUTME: Tests merge-view.js: computeHunks and the read-only hunk list.
// ABOUTME: The list has no buttons; nothing in it applies a change.
import { describe, expect, it } from "vitest";
import { computeHunks, diffTooLarge, renderHunkList } from "./merge-view.js";

describe("computeHunks", () => {
  it("keeps identical documents as equal hunks", () => {
    const hunks = computeHunks("a\nb", "a\nb");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("equal");
  });

  it("diffs a long file with one changed line without a full matrix", () => {
    const prefix = Array.from({ length: 20000 }, (_, index) => `line-${index}`);
    const original = [...prefix, "old", "tail"].join("\n");
    const proposed = [...prefix, "new", "tail"].join("\n");
    const started = Date.now();
    expect(diffTooLarge(original, proposed)).toBe(false);
    const edits = computeHunks(original, proposed).filter((hunk) => hunk.type === "edit");
    expect(Date.now() - started).toBeLessThan(200);
    expect(edits).toHaveLength(1);
    expect(edits[0].proposed).toEqual(["new"]);
  });

  it("splits a changed middle line into one edit hunk", () => {
    const hunks = computeHunks("keep\nold\nend", "keep\nnew\nend");
    const edits = hunks.filter((hunk) => hunk.type === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0].original).toEqual(["old"]);
    expect(edits[0].proposed).toEqual(["new"]);
  });
});

describe("renderHunkList", () => {
  it("shows removed then added lines, with the sign outside the text and no buttons", () => {
    const container = document.createElement("div");
    renderHunkList(container, computeHunks("keep\nold\nend", "keep\nnew\nend"));
    const lines = [...container.querySelectorAll(".merge-line")];
    expect(lines.map((line) => [line.getAttribute("data-sign"), line.textContent])).toEqual([
      ["-", "old"],
      ["+", "new"],
    ]);
    expect(container.querySelector("button")).toBeNull();
  });
});
