// ABOUTME: Tests findingsFromToolResult.
// ABOUTME: Severity 1-4 maps to error, warning, info, and hint.
import { describe, expect, it } from "vitest";
import { findingsFromToolResult, isLensTool } from "./lens-findings.js";

describe("isLensTool", () => {
  it("matches the lens_* family", () => {
    expect(isLensTool("lens_diagnostics")).toBe(true);
    expect(isLensTool("read")).toBe(false);
  });
});

describe("findingsFromToolResult", () => {
  it("reads details.diagnostics and ignores content blocks", () => {
    const parsed = findingsFromToolResult({
      content: [{ type: "text", text: "hello" }, { type: "text" }],
      details: {
        filePath: "src/a.ts",
        diagnostics: [
          { message: "real", severity: 1, source: "ts", code: 2322 },
          { message: { text: "nope" }, severity: 2 },
          { severity: 1 },
        ],
      },
    });
    expect(parsed?.findings).toEqual([
      {
        file: "src/a.ts",
        line: 0,
        column: 0,
        severity: "error",
        message: "real",
        source: "ts",
        code: "2322",
      },
    ]);
  });

  it("maps severity 1, 2, 3, and 4", () => {
    const parsed = findingsFromToolResult({
      details: {
        filePath: "src/a.ts",
        diagnostics: [
          { message: "e", severity: 1 },
          { message: "w", severity: 2 },
          { message: "i", severity: 3 },
          { message: "h", severity: 4 },
        ],
      },
    });
    expect(parsed?.findings.map((finding) => finding.severity)).toEqual([
      "error",
      "warning",
      "info",
      "hint",
    ]);
  });

  it("uses details.filePath in file mode and joins a relative path in directory mode", () => {
    const file = findingsFromToolResult({
      details: {
        filePath: "src\\a.ts",
        diagnostics: [
          { message: "alone", severity: 2, range: { start: { line: 3, character: 1 } } },
        ],
      },
    });
    expect(file?.findings[0]).toMatchObject({ file: "src/a.ts", line: 4, column: 2 });
    const directory = findingsFromToolResult({
      details: {
        filePath: "/proj/src",
        diagnostics: [{ file: "b.ts", message: "nested", severity: 3 }],
      },
    });
    expect(directory?.filePath).toBe("/proj/src");
    expect(directory?.findings[0].file).toBe("/proj/src/b.ts");
  });

  it("returns an empty list for a clean check and null when diagnostics are absent", () => {
    expect(
      findingsFromToolResult({ details: { filePath: "src/a.ts", diagnostics: [] } })?.findings,
    ).toEqual([]);
    expect(findingsFromToolResult({ content: [{ type: "text", text: "hello" }] })).toBeNull();
  });
});
