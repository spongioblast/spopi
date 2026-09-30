// ABOUTME: Tests chat scroll layout.
// ABOUTME: The case titles in this file name what it checks.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const styleCss = [
  "public/style.css",
  "public/app/shell/header.css",
  "public/app/chat/messages.css",
  "public/app/ui/message-renderer.css",
]
  .map((path) => readFileSync(resolve(path), "utf8"))
  .join("\n");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styleCss.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[2] ?? "";
}

describe("chat scroll layout", () => {
  test("lets the messages pane shrink inside the fixed viewport and own vertical overflow", () => {
    expect(ruleBody(".main")).toContain("min-height: 0");
    expect(ruleBody(".messages")).toContain("min-height: 0");
    expect(ruleBody(".messages")).toContain("overflow-y: auto");
    expect(ruleBody(".message")).toContain("min-width: 0");
    expect(ruleBody(".message .message-content")).toContain("max-width: 100%");
    expect(ruleBody(".message-content")).toContain("overflow-wrap: anywhere");
  });

  test("keeps every rendered turn row at its natural height so small overflows can scroll", () => {
    expect(ruleBody(".message")).toContain("flex-shrink: 0");
    expect(ruleBody(".process-details-group")).toContain("flex-shrink: 0");
  });

  test("uses a flex item for the composer inset so WebKit includes it in scroll overflow", () => {
    expect(ruleBody(".messages")).toContain("padding-bottom: 0");
    expect(ruleBody(".messages::after")).toContain("content:");
    expect(ruleBody(".messages::after")).toContain("flex-shrink: 0");
    expect(ruleBody(".messages::after")).toContain("flex-basis:");
  });
});
