// ABOUTME: Tests the numbered review diff.
// ABOUTME: Covers context, gaps, stable keys, new files, CRLF, and git patches.

import { describe, expect, it } from "vitest";
import { buildDiff, diffFromPatch, splitText } from "./review-diff-model.js";

describe("diffFromPatch", () => {
  it("numbers the rows of a commit patch like a built diff", () => {
    const patch = [
      "diff --git a/greet.js b/greet.js",
      "index 1111111..2222222 100644",
      "--- a/greet.js",
      "+++ b/greet.js",
      "@@ -1,3 +1,3 @@",
      " export function greet(name) {",
      '-  return "hi";',
      '+  return "hello";',
      " }",
      "\\ No newline at end of file",
    ].join("\n");
    const diff = diffFromPatch(patch);
    expect(diff).toMatchObject({ add: 1, del: 1, tooLarge: false, gaps: [] });
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].header).toBe("@@ -1,3 +1,3 @@");
    expect(diff.hunks[0].rows.map((/** @type {any} */ row) => row.kind)).toEqual([
      "ctx",
      "del",
      "add",
      "ctx",
    ]);
    expect(diff.hunks[0].rows[2]).toMatchObject({ oldNo: null, newNo: 2 });
    expect(diff.hunks[0].proposed).toEqual([
      "export function greet(name) {",
      '  return "hello";',
      "}",
    ]);
  });
});

describe("buildDiff", () => {
  it("numbers a known change and keeps three lines of context", () => {
    const before = ["a", "b", "c", "old", "d", "e", "f"].join("\n");
    const after = ["a", "b", "c", "new", "d", "e", "f"].join("\n");
    const diff = buildDiff(before, after);
    expect(diff.tooLarge).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    const hunk = diff.hunks[0];
    expect(hunk.header).toBe("@@ -1,7 +1,7 @@");
    expect(hunk.rows.map((row) => `${row.kind}:${row.text}`)).toEqual([
      "ctx:a",
      "ctx:b",
      "ctx:c",
      "del:old",
      "add:new",
      "ctx:d",
      "ctx:e",
      "ctx:f",
    ]);
    expect(buildDiff(before, after).hunks[0].key).toBe(hunk.key);
  });

  it("folds a far unchanged run and merges close hunks", () => {
    const before = ["a", "old1", "b", "c", "d", "e", "f", "g", "h", "i", "j", "old2"].join("\n");
    const after = ["a", "new1", "b", "c", "d", "e", "f", "g", "h", "i", "j", "new2"].join("\n");
    const diff = buildDiff(before, after);
    expect(diff.hunks.length).toBe(2);
    expect(diff.gaps.length).toBe(1);
    expect(diff.gaps[0].count).toBeGreaterThan(0);
    const close = buildDiff("a\nold1\nb\nold2\nc", "a\nnew1\nb\nnew2\nc");
    expect(close.hunks).toHaveLength(1);
  });

  it("treats a new file as all added lines", () => {
    const diff = buildDiff("", "a\nb\n");
    expect(diff.hunks[0].rows.every((row) => row.kind === "add")).toBe(true);
    expect(diff.add).toBe(2);
  });

  it("reads CRLF files as the same lines as LF files", () => {
    const split = splitText("a\r\nb\r\n");
    expect(split.lines).toEqual(["a", "b"]);
    expect(split.finalNewline).toBe(true);
    expect(buildDiff("a\r\nb\r\n", "a\nb\n").hunks).toHaveLength(0);
  });
});
