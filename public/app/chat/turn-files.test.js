// ABOUTME: Tests turn-files.js: line counts per write or edit call, and merging a prompt's turns.
// ABOUTME: Pi opens a turn per model step, so the files are spread over several turns.
import { describe, expect, it } from "vitest";
import { pushChangedFile } from "./transcript-turns.js";
import { mergeTurnFiles, toolLineCounts } from "./turn-files.js";

describe("toolLineCounts", () => {
  it("counts an edit from Pi's edits[] oldText and newText", () => {
    const args = {
      path: "todo.js",
      edits: [
        { oldText: "a\nb", newText: "a\nb\nc" },
        { oldText: "x", newText: "y" },
      ],
    };
    expect(toolLineCounts("edit", args)).toEqual({ add: 4, del: 3 });
  });

  it("counts the single-edit form and a write", () => {
    expect(toolLineCounts("edit", { oldText: "one", newText: "one\ntwo" })).toEqual({
      add: 2,
      del: 1,
    });
    expect(toolLineCounts("write", { content: "a\n\nb\n" })).toEqual({ add: 2, del: 0 });
  });

  it("gives a live edit the same counts as rebuilt history", () => {
    const turn = /** @type {any} */ ({ files: [] });
    const args = { path: "todo.js", edits: [{ oldText: "a", newText: "a\nb" }] };
    expect(pushChangedFile(turn, "edit", args).files).toEqual([
      { path: "todo.js", add: 2, del: 1 },
    ]);
  });
});

describe("mergeTurnFiles", () => {
  it("merges every step of the prompt, one row per path", () => {
    const turns = [
      { files: [{ path: "index.html", add: 10, del: 0 }] },
      {
        files: [
          { path: "app.js", add: 30, del: 0 },
          { path: "index.html", add: 2, del: 1 },
        ],
      },
      { files: [] },
    ];
    expect(mergeTurnFiles(turns)).toEqual([
      { path: "index.html", add: 12, del: 1 },
      { path: "app.js", add: 30, del: 0 },
    ]);
  });

  it("returns nothing for a prompt that wrote no files", () => {
    expect(mergeTurnFiles([{ files: [] }, {}])).toEqual([]);
  });
});
