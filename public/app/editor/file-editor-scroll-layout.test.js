// ABOUTME: Tests file editor scroll layout.
// ABOUTME: Includes "constrains the CodeMirror chain and gives scrolling to its scroller".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const styleCss = readFileSync(resolve("public/app/editor/file-preview-panel.css"), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styleCss.matchAll(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[2])
    .join("\n");
}

describe("file editor scroll layout", () => {
  test("constrains the CodeMirror chain and gives scrolling to its scroller", () => {
    expect(ruleBody(".file-preview-content")).toContain("min-height: 0");
    expect(ruleBody(".file-code-editor")).toContain("min-height: 0");
    expect(ruleBody(".file-code-editor")).toContain("overflow: hidden");
    expect(ruleBody(".file-code-editor .cm-editor")).toContain("min-height: 0");
    expect(ruleBody(".file-code-editor .cm-scroller")).toContain("overflow: auto");
  });

  test("gives the diff view its own bounded two-axis scroller", () => {
    expect(ruleBody(".file-diff-view")).toContain("height: 100%");
    expect(ruleBody(".file-diff-view")).toContain("width: 100%");
    expect(ruleBody(".file-diff-view")).toContain("min-width: 0");
    expect(ruleBody(".file-diff-view")).toContain("overflow: auto");
  });

  test("themes CodeMirror line numbers with SPOPI color tokens", () => {
    const gutters = ruleBody(".file-code-editor .cm-gutters");
    expect(gutters).toContain("background: var(--bg-solid)");
    expect(gutters).toContain("border-right: 1px solid var(--border)");

    const activeGutter = ruleBody(".file-code-editor .cm-activeLineGutter");
    expect(activeGutter).toContain("background: var(--bg-glass-hover)");
    expect(activeGutter).toContain("color: var(--text-secondary)");
  });
});
