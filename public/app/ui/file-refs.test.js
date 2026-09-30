// ABOUTME: Tests file-refs.
// ABOUTME: Includes "looksLikeWorkspacePath accepts paths and rejects URLs and spaces".
// ABOUTME: Workspace path detection and history-render file-ref buttons.

import { expect, test } from "vitest";
import { linkifyFileRefs, looksLikeWorkspacePath, parsePathRef } from "./file-refs.js";

test("looksLikeWorkspacePath accepts paths and rejects URLs and spaces", () => {
  expect(looksLikeWorkspacePath("src/app.js")).toBe(true);
  expect(looksLikeWorkspacePath("src/app.js:12")).toBe(true);
  expect(looksLikeWorkspacePath("README.md")).toBe(true);
  expect(looksLikeWorkspacePath("https://example.com/a.js")).toBe(false);
  expect(looksLikeWorkspacePath("hello world.js")).toBe(false);
  expect(looksLikeWorkspacePath("justword")).toBe(false);
  expect(looksLikeWorkspacePath("/thinking-budget")).toBe(false);
  expect(looksLikeWorkspacePath("/reload")).toBe(false);
  expect(looksLikeWorkspacePath("<folder>_statistics.json")).toBe(false);
  expect(looksLikeWorkspacePath("~/.pi/agent/extensions/vllm-thinking-budget.ts")).toBe(true);
});

test("parsePathRef reads optional line and column", () => {
  expect(parsePathRef("src/app.js:12")).toEqual({ path: "src/app.js", line: 12 });
  expect(parsePathRef("src/app.js:12:4")).toEqual({ path: "src/app.js", line: 12 });
  expect(parsePathRef("src/app.js")).toEqual({ path: "src/app.js", line: undefined });
});

test("linkifyFileRefs turns a code span path into a previewfile button", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>see <code>src/app.js:12</code></p>";
  const opened = [];
  linkifyFileRefs(root, { onOpen: (path, line) => opened.push({ path, line }) });
  const button = root.querySelector(".chat-file-ref");
  expect(button).toBeTruthy();
  expect(button.dataset.path).toBe("src/app.js");
  expect(button.dataset.line).toBe("12");
  button.click();
  expect(opened).toEqual([{ path: "src/app.js", line: 12 }]);
});

test("linkifyFileRefs turns user @mentions into previewfile buttons", () => {
  const root = document.createElement("div");
  root.className = "message user";
  root.textContent = "please read @README.md";
  linkifyFileRefs(root);
  const button = root.querySelector(".chat-file-ref");
  expect(button?.dataset.path).toBe("README.md");
});
