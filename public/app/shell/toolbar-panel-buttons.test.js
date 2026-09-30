// ABOUTME: Verifies the file-sidebar toggle uses the shared icon-button
// ABOUTME: design system.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { mountAppChrome } from "./app-chrome.js";

const publicDir = join(process.cwd(), "public");
const designSystemCss = readFileSync(join(publicDir, "design-system.css"), "utf8");

function chrome() {
  const root = document.createElement("div");
  mountAppChrome(root);
  return root;
}

test("file sidebar uses the shared icon-button control", () => {
  const root = chrome();
  const button = root.querySelector("#file-sidebar-toggle");

  expect(button?.classList.contains("ui-icon-button")).toBe(true);
  expect(button?.getAttribute("aria-label")).toBe("Toggle file browser");
});

test("file sidebar toggle hosts the workspace path label", () => {
  const root = chrome();
  const button = root.querySelector("#file-sidebar-toggle");
  const label = button?.querySelector("#workspace-indicator");

  expect(button?.classList.contains("file-sidebar-toggle")).toBe(true);
  expect(label?.classList.contains("file-sidebar-toggle__label")).toBe(true);
  expect(root.querySelectorAll("#workspace-indicator")).toHaveLength(1);
});

test("file sidebar header has no Files/Git text and keeps action icons", () => {
  const root = chrome();
  const header = root.querySelector("#file-sidebar .file-sidebar-header");
  expect(header?.textContent.trim()).toBe("");
  expect(root.querySelector("#file-sidebar-title")).toBeNull();
  expect(root.querySelector("#file-sidebar-files-tab")).toBeNull();
  expect(root.querySelector("#file-sidebar-git-tab")).toBeNull();
  expect(root.querySelector("#file-sidebar-up")).not.toBeNull();
  expect(root.querySelector("#file-sidebar-finder")).not.toBeNull();
  expect(root.querySelector("#file-sidebar-close")).not.toBeNull();
});

test("icon-button design system defines the shared control contract", () => {
  expect(designSystemCss).toContain(".ui-icon-button");
  expect(designSystemCss).toContain("border-radius: var(--radius-md);");
  expect(designSystemCss).toContain("width: var(--control-height-md);");
});
