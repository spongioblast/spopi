// ABOUTME: Tests digest: which head and tail lines the model sees, and the header that names the saved file.
// ABOUTME: Includes "keeps the error at the end of a long build log".

// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildDigest,
  formatSize,
  HEAD_LINES,
  linesOfText,
  MAX_LINE_CHARS,
  pickFromLines,
  pickFromWindows,
  TAIL_LINES,
} from "./digest";

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`);

describe("digest", () => {
  it("keeps the error at the end of a long build log", () => {
    const lines = [...numbered(3000), "src/cart.ts(3,1): error TS2322: bad", "Found 1 error."];
    const picked = pickFromLines(lines);
    expect(picked.head).toEqual(numbered(HEAD_LINES));
    expect(picked.tail.at(-1)).toBe("Found 1 error.");
    expect(picked.tail).toContain("src/cart.ts(3,1): error TS2322: bad");
    expect(picked.tail.length).toBe(TAIL_LINES);
    expect(picked.omitted).toBe(lines.length - HEAD_LINES - TAIL_LINES);
  });

  it("never shows a line twice when head and tail meet", () => {
    const lines = numbered(30).map((line) => `${line} ${"x".repeat(40)}`);
    const picked = pickFromLines(lines);
    expect(picked.head.length + picked.tail.length + (picked.omitted ?? 0)).toBe(30);
    expect(new Set([...picked.head, ...picked.tail]).size).toBe(
      picked.head.length + picked.tail.length,
    );
  });

  it("cuts one enormous line instead of dropping it", () => {
    const picked = pickFromLines([`{"data":"${"a".repeat(100_000)}"}`]);
    expect(picked.head).toHaveLength(1);
    expect(picked.head[0].length).toBeLessThan(MAX_LINE_CHARS + 50);
    expect(picked.head[0]).toContain("line cut at");
    expect(picked.tail).toEqual([]);
    expect(picked.omitted).toBe(0);
  });

  it("drops the lines cut by the window edges of a large file", () => {
    const picked = pickFromWindows("first\nsecond\nthi", "rd-last\nsecond-last\nlast\n", 9000);
    expect(picked.head).toEqual(["first", "second"]);
    expect(picked.tail).toEqual(["second-last", "last"]);
    expect(picked.omitted).toBe(9000 - 4);
  });

  it("names the file, the size, and how much is hidden", () => {
    const text = buildDigest({
      relativePath: ".pi/tmp/tool-output/bash-20260927-184512-call_0.log",
      totalBytes: 186_000,
      totalLines: 4210,
      lines: { head: ["a"], tail: ["y", "z"], omitted: 4207 },
    });
    expect(text.split("\n")[0]).toBe(
      "[Long output (181.6 KB, 4,210 lines), saved in full to .pi/tmp/tool-output/bash-20260927-184512-call_0.log. The first 1 and last 2 lines are below; read or search that file for the rest.]",
    );
    expect(text).toBe(`${text.split("\n")[0]}\na\n[... 4,207 lines not shown ...]\ny\nz`);
  });

  it("says when every line is shown", () => {
    const text = buildDigest({
      relativePath: "out.log",
      totalBytes: 20_000,
      totalLines: 1,
      lines: { head: ["only"], tail: [], omitted: 0 },
    });
    expect(text).toContain("Every line is below, long lines cut short");
    expect(text).not.toContain("not shown");
  });

  it("splits CRLF output and ignores the final newline", () => {
    expect(linesOfText("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
