// ABOUTME: Tests check-report on real tsc, biome, cargo, and eslint output shapes.
// ABOUTME: Includes "keeps only the tsc lines for changed files".

// @vitest-environment node

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  capLines,
  describeChangedFiles,
  MAX_REPORT_LINES,
  outputTail,
  parseFindings,
  relevantOutput,
  repairMessage,
} from "./check-report";

describe("parseFindings", () => {
  const root = path.resolve("/work/app");
  const at = (file: string) => path.resolve(root, file).replaceAll("\\", "/");

  it("reads tsc, ruff, cargo, mypy, and biome lines", () => {
    const output = [
      "src/cart.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/cart.ts:9:2 - error TS2304: Cannot find name 'x'.",
      "tools/a.py:1:8: F401 [*] `os` imported but unused",
      "src/main.rs:4:9: warning[unused_variables]: unused variable: `y`",
      "pkg/b.py:12: note: Revealed type is int",
      "src/ui.ts:7:3 lint/style/useConst  FIXABLE  ━━━━━━━━━━",
      "  --> src/main.rs:4:9",
      "Found 3 errors.",
    ].join("\n");
    expect(parseFindings(output, root)).toEqual([
      {
        file: at("src/cart.ts"),
        line: 3,
        column: 5,
        severity: "error",
        message: "Type 'string' is not assignable to type 'number'.",
        code: "TS2322",
      },
      {
        file: at("src/cart.ts"),
        line: 9,
        column: 2,
        severity: "error",
        message: "Cannot find name 'x'.",
        code: "TS2304",
      },
      {
        file: at("tools/a.py"),
        line: 1,
        column: 8,
        severity: "error",
        message: "`os` imported but unused",
        code: "F401",
      },
      {
        file: at("src/main.rs"),
        line: 4,
        column: 9,
        severity: "warning",
        message: "unused variable: `y`",
        code: "unused_variables",
      },
      {
        file: at("pkg/b.py"),
        line: 12,
        column: 0,
        severity: "info",
        message: "Revealed type is int",
        code: "",
      },
      {
        file: at("src/ui.ts"),
        line: 7,
        column: 3,
        severity: "error",
        message: "lint/style/useConst FIXABLE",
        code: "lint/style/useConst",
      },
    ]);
  });

  it("keeps a Windows drive path whole", () => {
    const [finding] = parseFindings("D:\\w\\a.py:2:1: E999 SyntaxError: bad", root);
    expect(finding?.file).toBe("D:/w/a.py");
    expect(finding?.line).toBe(2);
  });

  it("caps the list", () => {
    const output = Array.from({ length: 400 }, (_, i) => `a.py:${i + 1}:1: F401 x`).join("\n");
    expect(parseFindings(output, root)).toHaveLength(200);
  });
});

const cwd = path.resolve("/work/app");
const changed = describeChangedFiles(cwd, [path.join(cwd, "src", "cart.ts")]);

describe("relevantOutput", () => {
  it("keeps only the tsc lines for changed files", () => {
    const tsc = [
      "src/cart.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/other.ts(3,1): error TS2304: Cannot find name 'x'.",
      "src/cart.ts(20,9): error TS2339: Property 'total' does not exist on type 'Cart'.",
      "Found 3 errors in 2 files.",
    ].join("\n");
    expect(relevantOutput(tsc, changed)).toEqual([
      "src/cart.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/cart.ts(20,9): error TS2339: Property 'total' does not exist on type 'Cart'.",
      "Found 3 errors in 2 files.",
    ]);
  });

  it("keeps a whole cargo block whose location line names the changed file", () => {
    const rs = describeChangedFiles(cwd, ["src/main.rs"]);
    const cargo = [
      "error[E0308]: mismatched types",
      " --> src/main.rs:3:18",
      "  |",
      '3 |     let n: u32 = "one";',
      "  |                  ^^^^^ expected `u32`, found `&str`",
      "",
      "error: unused variable",
      " --> src/lib.rs:9:9",
    ].join("\n");
    expect(relevantOutput(cargo, rs)).toEqual([
      "error[E0308]: mismatched types",
      " --> src/main.rs:3:18",
      "  |",
      '3 |     let n: u32 = "one";',
      "  |                  ^^^^^ expected `u32`, found `&str`",
    ]);
  });

  it("keeps an eslint file block, whose findings carry no path", () => {
    const eslint = [
      `${path.join(cwd, "src", "cart.ts")}`,
      "  4:10  error  'unused' is defined but never used  no-unused-vars",
      "",
      `${path.join(cwd, "src", "b.ts")}`,
      "  1:1  error  Unexpected var  no-var",
    ].join("\n");
    expect(relevantOutput(eslint, changed)).toEqual([
      path.join(cwd, "src", "cart.ts"),
      "  4:10  error  'unused' is defined but never used  no-unused-vars",
    ]);
  });

  it("returns nothing when the failure names no changed file", () => {
    expect(relevantOutput("src/other.ts:1:1 lint/style ━━━\n  × bad", changed)).toEqual([]);
    expect(relevantOutput("anything", [])).toEqual([]);
  });

  it("does not match a basename that is only part of a longer name", () => {
    expect(relevantOutput("src/mycart.ts(1,1): error TS1", changed)).toEqual([]);
  });
});

describe("messages", () => {
  it("caps long output and says how much was left out", () => {
    const lines = Array.from({ length: MAX_REPORT_LINES + 5 }, (_, i) => `src/cart.ts(${i},1): e`);
    expect(capLines(lines).omitted).toBe(5);
    const message = repairMessage({
      command: "bun run check",
      exitCode: 1,
      lines,
      logPath: "/tmp/spopi-verify/s.log",
    });
    expect(message.startsWith("`bun run check` failed after your edits (exit 1).")).toBe(true);
    expect(message).toContain("5 more line(s) are in the full output.");
    expect(message).toContain("Full output: /tmp/spopi-verify/s.log");
    expect(message).toContain(
      "If this comes from your change, fix it. If it does not, say so and stop.",
    );
    expect(message).not.toMatch(/every|each|before continuing/i);
  });

  it("takes the last non-empty lines as a tail", () => {
    expect(outputTail("a\n\nb\r\nc\n")).toEqual(["a", "b", "c"]);
    expect(outputTail(Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n"))).toHaveLength(
      MAX_REPORT_LINES,
    );
  });
});
