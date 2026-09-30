// ABOUTME: Tests extensions browse layout.
// ABOUTME: Includes "lets marketplace cards grow when badges wrap".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const styleCss = readFileSync(resolve("public/app/packages/packages-browse.css"), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styleCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("extensions browse layout", () => {
  test("lets marketplace cards grow when badges wrap", () => {
    const rowRule = ruleBody(".pkg-browse-row");

    expect(rowRule).toContain("height: auto");
    expect(rowRule).toContain("min-height: 140px");
    expect(rowRule).toContain("overflow: visible");
    expect(rowRule).not.toContain("overflow: hidden");
  });

  test("keeps the package title visible when badges wrap", () => {
    const nameRule = ruleBody(".pkg-browse-row .settings-extension-name");

    expect(nameRule).toContain("flex-shrink: 0");
  });

  test("clamps package descriptions to two hidden lines", () => {
    const descriptionRule = ruleBody(".pkg-browse-row .settings-extension-description");

    expect(descriptionRule).toContain("display: -webkit-box");
    expect(descriptionRule).toContain("flex-shrink: 0");
    expect(descriptionRule).toContain("-webkit-line-clamp: 2");
    expect(descriptionRule).toContain("overflow: hidden");
  });
});
