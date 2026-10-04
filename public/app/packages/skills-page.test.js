// ABOUTME: Guards Packages settings chrome and the shared sub-tab type scale.
// ABOUTME: Resources lives on the Packages page; the old Skills panel is gone.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { mountExtensionsSettings } from "../settings/extensions-settings.js";

function packagesMarkup() {
  const root = document.createElement("div");
  mountExtensionsSettings(root);
  return root;
}

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

test("Packages page has a title and a Resources tab", () => {
  const packages = packagesMarkup();
  expect(packages.querySelector('[data-i18n="settings.packages.title"]')).not.toBeNull();
  expect(packages.querySelector('[data-extensions-view="resources"]')).not.toBeNull();
  expect(packages.querySelector("#settings-resources")).not.toBeNull();
  expect(packages.querySelector('[data-settings-panel="skills"]')).toBeNull();
});

test("Packages sub-tabs are underline tabs at the settings body type scale", () => {
  const packages = packagesMarkup();
  const tabs = packages.querySelector("#extensions-tabs");
  expect(tabs?.classList.contains("ui-tabs--underline")).toBe(true);
  expect(tabs?.querySelector(".skills-page-tab")?.classList.contains("ui-tab")).toBe(true);
  const css = readFileSync(resolve(process.cwd(), "public/design-system.css"), "utf8");
  expect(ruleBody(css, ".ui-tab")).toContain("font: inherit");
  expect(ruleBody(css, ".ui-tabs--underline .ui-tab")).toContain("font-size: var(--font-size-md)");
});
