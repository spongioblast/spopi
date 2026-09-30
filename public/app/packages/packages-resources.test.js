// ABOUTME: Tests mountResourcesTab.
// ABOUTME: Includes "renders a section per resource kind and toggles through the gateway".
// ABOUTME: Resources tab lists Pi resources and toggles them through the config gateway.

import { afterEach, describe, expect, test, vi } from "vitest";
import { mountResourcesTab } from "./packages-resources.js";

vi.mock("../i18n/i18n.js", () => ({
  t: (key) => key,
  onLocaleChange: () => () => {},
}));

afterEach(() => {
  document.body.innerHTML = "";
});

function sample() {
  return {
    scope: "global",
    trusted: true,
    items: [
      {
        kind: "skill",
        id: "package:skill:pi-lens:skills/grep",
        name: "Pi Lens Grep",
        description: "Search",
        origin: { type: "package", label: "npm:pi-lens", source: "npm:pi-lens" },
        scope: "global",
        enabled: true,
        path: "/skills/grep",
        relativePath: "skills/grep",
        ambiguous: false,
      },
      {
        kind: "prompt",
        id: "folder:prompt:global:prompts/review.md",
        name: "review",
        description: "Review the diff",
        origin: { type: "folder", label: "prompts" },
        scope: "global",
        enabled: true,
        path: "/prompts/review.md",
        relativePath: "prompts/review.md",
        ambiguous: false,
      },
    ],
  };
}

describe("mountResourcesTab", () => {
  test("renders a section per resource kind and toggles through the gateway", async () => {
    const container = document.createElement("div");
    const install = document.createElement("div");
    install.id = "settings-install-skills";
    install.className = "hidden";
    document.body.append(container);
    const rpcCommand = vi.fn(async (command) => {
      if (command.type === "list_resource_inventory") return { success: true, data: sample() };
      return { success: true, data: { inventory: sample(), runtimeRestartRequired: true } };
    });
    const tab = mountResourcesTab({ container, installContainer: install, rpcCommand });
    await tab.activate();
    expect(container.querySelectorAll(".resources-section")).toHaveLength(4);
    expect(container.querySelector('[data-kind="skill"]')?.textContent).toContain("Pi Lens Grep");
    expect(container.querySelector('[data-kind="extension"]')?.textContent).toContain(
      "settings.resources.empty",
    );
    container.querySelector('[data-kind="skill"] .settings-toggle').click();
    await Promise.resolve();
    expect(rpcCommand).toHaveBeenCalledWith({
      type: "set_resource_enabled",
      scope: "global",
      kind: "skill",
      id: "package:skill:pi-lens:skills/grep",
      enabled: false,
    });
    expect(container.textContent).toContain("settings.resources.savedRestart");
  });

  test("says Pi reloaded when the toggle applied without a restart", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rpcCommand = vi.fn(async (command) => {
      if (command.type === "list_resource_inventory") return { success: true, data: sample() };
      return { success: true, data: { inventory: sample(), reloaded: true } };
    });
    const onReloaded = vi.fn();
    const tab = mountResourcesTab({ container, rpcCommand, onReloaded });
    await tab.activate();
    container.querySelector('[data-kind="skill"] .settings-toggle').click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("settings.resources.savedReloaded");
    });
    expect(onReloaded).toHaveBeenCalled();
  });

  test("reloads when the project scope is selected", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rpcCommand = vi.fn(async () => ({
      success: true,
      data: { scope: "project", trusted: true, items: [] },
    }));
    const tab = mountResourcesTab({ container, rpcCommand });
    await tab.activate();
    container.querySelectorAll(".skills-scope-tab")[1].click();
    await Promise.resolve();
    expect(rpcCommand).toHaveBeenCalledWith({ type: "list_resource_inventory", scope: "project" });
  });
});
