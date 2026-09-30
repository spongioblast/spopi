// ABOUTME: Asserts each Settings page renders its own controls.
// ABOUTME: Navigation order comes from SETTINGS_TABS, not from index.html.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { mountAppearanceSettings } from "./appearance-settings.js";
import { mountConfigurationSettings } from "./configuration-settings.js";
import { mountExtensionsSettings } from "./extensions-settings.js";
import { mountGeneralSettings } from "./general-settings.js";
import { mountModelsSettings } from "./models-settings.js";
import { SETTINGS_TABS } from "./settings-panel.js";
import { mountTerminalSettings } from "./terminal-settings.js";
import { mountUsageSettings } from "./usage-settings.js";

function page(mount) {
  const root = document.createElement("div");
  mount(root);
  return root;
}

describe("settings pages render their own markup", () => {
  test("navigation order puts Appearance and Terminal after General, Models before Configuration", () => {
    const tabs = SETTINGS_TABS.map((tab) => tab.key);
    expect(tabs.indexOf("appearance")).toBe(tabs.indexOf("general") + 1);
    expect(tabs.indexOf("terminal")).toBe(tabs.indexOf("appearance") + 1);
    expect(tabs.indexOf("models")).toBeGreaterThan(tabs.indexOf("general"));
    expect(tabs.indexOf("configuration")).toBeGreaterThan(tabs.indexOf("models"));
    expect(tabs).not.toContain("chat");
    expect(SETTINGS_TABS.find((tab) => tab.key === "models").labelKey).toBe(
      "settings.models.title",
    );
    expect(SETTINGS_TABS.find((tab) => tab.key === "appearance").labelKey).toBe(
      "settings.appearance",
    );
  });

  test("General keeps language and agent rows and leaves the theme grid to Appearance", () => {
    const general = page(mountGeneralSettings);
    const appearance = page(mountAppearanceSettings);
    expect(general.querySelector("#theme-grid")).toBeNull();
    expect(general.querySelector("#setting-language")).not.toBeNull();
    expect(general.querySelector("#toggle-auto-compact")).not.toBeNull();
    expect(appearance.querySelector("#theme-grid")).not.toBeNull();
    expect(appearance.querySelector("#settings-chat-font-size")).not.toBeNull();
    expect(appearance.querySelector("#settings-preview-theme-select")).not.toBeNull();
    expect(appearance.querySelector("#settings-preview-font-size")).not.toBeNull();
    expect(appearance.querySelector("#settings-terminal-profile-select")).toBeNull();
  });

  test("Terminal renders shell, theme, font, scrollback, and WebGL", () => {
    const terminal = page(mountTerminalSettings);
    expect(terminal.querySelector("#settings-terminal-profile-select")).not.toBeNull();
    expect(terminal.querySelector("#settings-terminal-theme-select")).not.toBeNull();
    expect(terminal.querySelector("#settings-terminal-font-size")).not.toBeNull();
    expect(terminal.querySelector("#settings-terminal-scrollback-input")).not.toBeNull();
    expect(terminal.querySelector("#settings-terminal-smooth-scroll-input")).not.toBeNull();
    expect(terminal.querySelector("#toggle-terminal-webgl")).not.toBeNull();
  });

  test("Usage embeds the cost dashboard", () => {
    const usage = page(mountUsageSettings);
    expect(usage.querySelector("#settings-cost-dashboard")).not.toBeNull();
  });

  test("Packages renders the resources host", () => {
    const extensions = page(mountExtensionsSettings);
    expect(extensions.querySelector('[data-i18n="settings.packages.title"]')).not.toBeNull();
    expect(extensions.querySelector('[data-extensions-view="resources"]')).not.toBeNull();
    expect(extensions.querySelector("#settings-resources")).not.toBeNull();
    expect(extensions.querySelector('[data-i18n="extensions.bundled.title"]')).not.toBeNull();
    expect(extensions.querySelector("#load-spopi-pi-permission-system")).not.toBeNull();
    expect(extensions.querySelector('[data-settings-panel="skills"]')).toBeNull();
  });

  test("Configuration and Models stay split", () => {
    const configuration = page(mountConfigurationSettings);
    const models = page(mountModelsSettings);
    expect(configuration.querySelector("#inline-config-textarea")).not.toBeNull();
    expect(configuration.querySelector("#settings-api-keys")).toBeNull();
    expect(configuration.querySelector("#inline-models-textarea")).toBeNull();
    expect(models.querySelector("#settings-api-keys")).not.toBeNull();
    expect(models.querySelector("#inline-models-textarea")).not.toBeNull();
    expect(models.querySelector("#settings-auth-section")).toBeNull();
    expect(models.querySelector("#toggle-auth")).toBeNull();
  });

  test("activates the Models page through settings-panel routing", () => {
    const settingsPanelJs = readFileSync(
      join(process.cwd(), "public/app/settings/settings-panel.js"),
      "utf8",
    );
    const settingsConfigJs = readFileSync(
      join(process.cwd(), "public/app/settings/configuration-settings.js"),
      "utf8",
    );
    const modelsPageJs = readFileSync(
      join(process.cwd(), "public/app/settings/models-page.js"),
      "utf8",
    );
    expect(settingsPanelJs).toContain(
      'import { mountModelsSettings } from "./models-settings.js";',
    );
    expect(settingsPanelJs).toContain('if (target === "models") loadModels();');
    expect(settingsConfigJs).not.toContain("loadApiKeysPanel");
    expect(settingsConfigJs).not.toContain("loadInlineModelsEditor");
    expect(modelsPageJs).toContain("export function mountModelsPage");
    expect(modelsPageJs).toContain("loadApiKeysPanel");
    expect(modelsPageJs).toContain("loadInlineModelsEditor");
  });
});
