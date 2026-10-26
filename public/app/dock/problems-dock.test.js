// ABOUTME: Tests mountProblemsDock.
// ABOUTME: A finished lens result replaces findings for the files it covered.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mountProblemsDock } from "./problems-dock.js";
import { parseVerifyFindings } from "./verify-findings.js";

const en = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 */
function t(key, params = {}) {
  const value = key.split(".").reduce(
    (node, part) => {
      if (!node || typeof node !== "object") return undefined;
      return /** @type {Record<string, unknown>} */ (node)[part];
    },
    /** @type {unknown} */ (en),
  );
  if (typeof value !== "string") return key;
  return value.replace(/\{(\w+)\}/g, (_match, name) => {
    const next = params[String(name)];
    return next == null ? "" : String(next);
  });
}

describe("mountProblemsDock check reports", () => {
  it("shows the check's findings and replaces them on the next run", () => {
    const root = document.createElement("div");
    const opened = [];
    const dock = mountProblemsDock(root, {
      t,
      onOpenFile: (path, line) => opened.push([path, line]),
    });
    const report = parseVerifyFindings([
      JSON.stringify({
        command: "ruff check .",
        status: "failed",
        findings: [
          {
            file: "D:/w/a.py",
            line: 3,
            column: 1,
            severity: "error",
            message: "bad",
            code: "F401",
          },
        ],
      }),
    ]);
    if (!report) throw new Error("report did not parse");
    dock?.setCheckReport(report);
    expect(root.querySelector(".problems-check-status")?.textContent).toBe(
      "ruff check . failed: 1 findings",
    );
    expect(root.querySelector(".problem-path")?.textContent).toBe("D:/w/a.py");
    /** @type {HTMLElement | null} */ (root.querySelector(".problem-row"))?.click();
    expect(opened).toEqual([["D:/w/a.py", 3]]);

    dock?.setCheckReport({ command: "ruff check .", status: "passed", findings: [] });
    expect(root.querySelector(".problem-row")).toBeNull();
    expect(root.querySelector(".problems-check-status")?.textContent).toBe("ruff check . passed");
  });

  it("ignores a widget line that is not a report", () => {
    expect(parseVerifyFindings(["not json"])).toBeNull();
    expect(parseVerifyFindings([JSON.stringify({ command: "x", status: "odd" })])).toBeNull();
  });
});

describe("mountProblemsDock", () => {
  it("renders diagnostic messages instead of content blocks", () => {
    const root = document.createElement("div");
    const opened = [];
    const dock = mountProblemsDock(root, {
      t,
      onOpenFile: (path, line) => opened.push([path, line]),
    });
    dock?.noteResult("read", {
      details: { filePath: "src/a.ts", diagnostics: [{ message: "skip", severity: 1 }] },
    });
    expect(root.querySelector(".problem-row")).toBeNull();
    dock?.noteResult("lens_diagnostics", {
      content: [{ type: "text", text: "summary" }, { type: "text" }],
      details: {
        filePath: "src/a.ts",
        diagnostics: [
          {
            message: "type error",
            severity: 1,
            source: "ts",
            code: 2322,
            range: { start: { line: 9, character: 2 } },
          },
          { message: "unused", severity: 4, source: "eslint" },
        ],
      },
    });
    expect(root.textContent).toContain("type error");
    expect(root.textContent).not.toContain("[object Object]");
    expect(root.textContent).not.toContain("summary");
    expect(root.querySelector(".problem-count")?.textContent).toBe("2");
    expect(root.querySelector(".problem-meta")?.textContent).toBe("ts 2322");
    expect(root.querySelector(".problem-loc")?.textContent).toBe("10:3");
    expect([...root.querySelectorAll(".problem-severity")].map((node) => node.textContent)).toEqual(
      ["Error", "Hint"],
    );
    root
      .querySelector("button.problem-row")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened).toEqual([["src/a.ts", 10]]);
  });

  it("clears a file on a clean re-check and leaves other files", () => {
    const root = document.createElement("div");
    const dock = mountProblemsDock(root, { t });
    dock?.noteResult("lens_diagnostics", {
      details: {
        filePath: "/proj/src/a.ts",
        diagnostics: [{ message: "alpha", severity: 1 }],
      },
    });
    dock?.noteResult("lens_diagnostics", {
      details: {
        filePath: "/proj/src/b.ts",
        diagnostics: [{ message: "beta", severity: 2 }],
      },
    });
    dock?.noteResult("lens_diagnostics", {
      details: { filePath: "/proj/src/a.ts", diagnostics: [] },
    });
    expect(root.textContent).not.toContain("alpha");
    expect(root.textContent).toContain("beta");
    dock?.noteResult("lens_diagnostics", {
      details: { filePath: "/proj/src", diagnostics: [] },
    });
    expect(root.querySelector(".problem-row")).toBeNull();
  });

  it("shows one muted row when the tool result is an error", () => {
    const root = document.createElement("div");
    const dock = mountProblemsDock(root, { t });
    dock?.noteResult("lens_diagnostics", {
      details: {
        filePath: "src/a.ts",
        diagnostics: [{ message: "type error", severity: 1 }],
      },
    });
    dock?.noteResult("lens_diagnostics", {
      isError: true,
      content: [{ type: "text", text: "server crashed" }, { type: "text" }],
    });
    const rows = root.querySelectorAll(".problem-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.classList.contains("problem-row-muted")).toBe(true);
    expect(rows[0]?.textContent).toBe("server crashed");
    expect(root.textContent).not.toContain("[object Object]");
    expect(root.textContent).not.toContain("type error");
  });

  it("describes the language server status in the header", () => {
    const root = document.createElement("div");
    const dock = mountProblemsDock(root, { t });
    const header = () => root.querySelector(".problems-language-status");
    dock?.setLanguageStatus("LSP Inactive");
    expect(header()?.hidden).toBe(false);
    expect(header()?.textContent).toBe("Language servers: none running");
    dock?.setLanguageStatus("LSP Active: typescript, eslint");
    expect(header()?.textContent).toBe("Language servers: typescript, eslint");
    dock?.setLanguageStatus("LSP Failed: timeout");
    expect(header()?.textContent).toBe("failed: timeout");
    dock?.clear();
    expect(header()?.textContent).toBe("failed: timeout");
  });
});
