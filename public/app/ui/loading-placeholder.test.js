// ABOUTME: Guards the shared loading placeholder: spinner icon plus visible label.
// ABOUTME: The localized loading string is the visible text, not an empty aria-only node.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  applyLoadingPlaceholder,
  clearLoadingPlaceholder,
  createLoadingPlaceholder,
} from "./loading-placeholder.js";

afterEach(() => {
  document.body.replaceChildren();
});

test("createLoadingPlaceholder shows the loading label next to the spinner class", () => {
  const node = createLoadingPlaceholder({
    className: "skills-loading",
    label: "Loading skills…",
  });
  expect(node.classList.contains("ui-loading")).toBe(true);
  expect(node.classList.contains("skills-loading")).toBe(true);
  expect(node.getAttribute("role")).toBe("status");
  expect(node.getAttribute("aria-busy")).toBe("true");
  expect(node.textContent).toBe("Loading skills…");
  expect(node.getAttribute("aria-label")).toBeNull();
});

test("applyLoadingPlaceholder keeps the loading copy as visible text", () => {
  const node = document.createElement("div");
  node.textContent = "Loading providers…";
  applyLoadingPlaceholder(node, { label: "Loading providers…" });
  expect(node.textContent).toBe("Loading providers…");
  expect(node.classList.contains("ui-loading")).toBe(true);
});

test("clearLoadingPlaceholder drops the busy placeholder so real copy can render", () => {
  const node = createLoadingPlaceholder({ label: "Loading…" });
  clearLoadingPlaceholder(node);
  node.textContent = "v1.2.3";
  expect(node.classList.contains("ui-loading")).toBe(false);
  expect(node.getAttribute("aria-busy")).toBeNull();
  expect(node.textContent).toBe("v1.2.3");
});

test("design system draws a spinning loading icon", () => {
  const css = readFileSync(resolve(process.cwd(), "public/design-system.css"), "utf8");
  expect(css).toContain(".ui-loading::before");
  expect(css).toContain("@keyframes ui-loading-spin");
  expect(css).toContain("color: var(--text-placeholder)");
  expect(css).toContain("border-top-color: var(--accent)");
  expect(css).toContain("prefers-reduced-motion");
  expect(css).not.toContain("--text-dim");
});
