// ABOUTME: Checks the overlay z-index scale: settings < surface modals < dialogs < popovers.
// ABOUTME: Every dialog opened from Settings must render in front of the Settings panel.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path) => readFileSync(path, "utf8");

/** @param {string} css @param {string} selector */
function zIndexOf(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|\\n|,\\s*)${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  return rule?.groups?.body.match(/z-index:\s*(?<value>[^;]+);/)?.groups?.value.trim();
}

describe("overlay layering", () => {
  test("the scale tokens increase from settings to popovers", () => {
    const theme = read("public/style-theme.css");
    const token = (name) => Number(theme.match(new RegExp(`--${name}:\\s*(\\d+);`))?.[1]);
    const settings = token("z-settings");
    const surface = token("z-surface-modal");
    const dialog = token("z-dialog");
    const popover = token("z-popover");
    expect(settings).toBeGreaterThan(0);
    expect(surface).toBeGreaterThan(settings);
    expect(dialog).toBeGreaterThan(surface);
    expect(popover).toBeGreaterThan(dialog);
  });

  test.each([
    ["public/app/settings/settings-panel.css", ".settings-panel", "var(--z-settings)"],
    [
      "public/app/settings/settings-config.css",
      ".models-json-dialog-backdrop",
      "var(--z-surface-modal)",
    ],
    ["public/app/settings/settings-config.css", ".config-editor-overlay", "var(--z-surface-modal)"],
    [
      "public/app/settings/settings-config.css",
      ".oauth-login-dialog-backdrop",
      "var(--z-surface-modal)",
    ],
    ["public/app/extension-ui/dialog.css", "#dialog-container", "var(--z-dialog)"],
    ["public/app/settings/settings-config.css", ".provider-picker-backdrop", "var(--z-dialog)"],
    ["public/app/extension-ui/custom-ui-panel.css", ".custom-ui-overlay", "var(--z-dialog)"],
    ["public/app/session/session-search-dialog.css", ".session-search-overlay", "var(--z-dialog)"],
    ["public/design-system.css", ".ui-select-popover", "var(--z-popover)"],
    ["public/app/ui/popover.css", ".ui-popover", "var(--z-popover)"],
  ])("%s %s uses %s", (file, selector, expected) => {
    expect(zIndexOf(read(file), selector)).toBe(expected);
  });
});
