// ABOUTME: Tests General settings toggles.
// ABOUTME: A click round-trips auto-compaction through the config gateway.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUiStore, uiStore } from "../storage/ui-store.js";
import { mountGeneralSettings } from "./general-settings.js";

describe("mountSettingsToggles", () => {
  let container;

  beforeEach(() => {
    resetUiStore();

    // Clear body dataset
    delete document.body.dataset.autoCompact;
    delete document.body.dataset.showThinking;

    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    resetUiStore();
  });

  it("initializes toggles with default values", () => {
    mountGeneralSettings(container);

    const autoCompactBtn = document.getElementById("toggle-auto-compact");
    const showThinkingBtn = document.getElementById("toggle-show-thinking");
    const taskNotificationsBtn = document.getElementById("toggle-task-notifications");

    expect(autoCompactBtn.classList.contains("on")).toBe(true);
    expect(showThinkingBtn.classList.contains("on")).toBe(true);
    expect(taskNotificationsBtn.classList.contains("on")).toBe(true);

    expect(autoCompactBtn.getAttribute("aria-checked")).toBe("true");
    expect(showThinkingBtn.getAttribute("aria-checked")).toBe("true");
    expect(taskNotificationsBtn.getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("toggle-beta-updates")).toBeNull();
  });

  it("loads show thinking from Pi and saves clicks there", async () => {
    const configGateway = {
      call: vi.fn(async (op) => {
        if (op === "get_show_thinking") return { ok: true, data: { enabled: false } };
        return { ok: true, data: { enabled: true } };
      }),
    };
    mountGeneralSettings(container, { configGateway });
    await vi.waitFor(() => {
      expect(document.getElementById("toggle-show-thinking").classList.contains("on")).toBe(false);
    });
    document.getElementById("toggle-show-thinking").click();
    await vi.waitFor(() => {
      expect(configGateway.call).toHaveBeenCalledWith("set_show_thinking", { enabled: true });
    });
    expect(uiStore.getItem("ui.settings.show-thinking")).toBeNull();
  });

  it("moves an old local show-thinking value into Pi once", async () => {
    uiStore.setItem("ui.settings.show-thinking", "false");
    const configGateway = { call: vi.fn(async () => ({ ok: true, data: { enabled: false } })) };
    mountGeneralSettings(container, { configGateway });
    await vi.waitFor(() => {
      expect(configGateway.call).toHaveBeenCalledWith("set_show_thinking", { enabled: false });
    });
    expect(configGateway.call).not.toHaveBeenCalledWith("get_show_thinking", {});
    await vi.waitFor(() => expect(uiStore.getItem("ui.settings.show-thinking")).toBeNull());
    expect(document.getElementById("toggle-show-thinking").classList.contains("on")).toBe(false);
  });

  it("persists auto-compaction to config on click", async () => {
    const configGateway = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const control = mountGeneralSettings(container, { configGateway });

    const autoCompactBtn = document.getElementById("toggle-auto-compact");
    expect(autoCompactBtn.classList.contains("on")).toBe(true);

    autoCompactBtn.click();
    await vi.waitFor(() => {
      expect(configGateway.call).toHaveBeenCalledWith("set_default_auto_compaction", {
        enabled: false,
        scope: "global",
      });
    });

    expect(autoCompactBtn.classList.contains("on")).toBe(false);
    expect(autoCompactBtn.getAttribute("aria-checked")).toBe("false");
    expect(uiStore.getItem("ui.settings.auto-compact")).toBeNull();
    expect(control.getToggleState("auto-compact")).toBe(false);
  });

  it("applies onChange callbacks", () => {
    mountGeneralSettings(container);

    const showThinkingBtn = document.getElementById("toggle-show-thinking");

    // Initially on
    expect(document.body.dataset.showThinking).toBe("on");

    // Toggle off
    showThinkingBtn.click();
    expect(document.body.dataset.showThinking).toBe("off");

    // Toggle back on
    showThinkingBtn.click();
    expect(document.body.dataset.showThinking).toBe("on");
  });

  it("provides getToggleState API", () => {
    uiStore.setItem("ui.settings.auto-compact", "true");
    const control = mountGeneralSettings(container);

    expect(control.getToggleState("auto-compact")).toBe(true);
    expect(control.getToggleState("show-thinking")).toBe(true); // default
    expect(control.getToggleState("task-notifications")).toBe(true); // default
  });

  it("sends the live RPC before writing auto-compaction", async () => {
    const order = [];
    const configGateway = {
      call: vi.fn(async (op) => {
        if (op === "set_default_auto_compaction") order.push("config");
        return { ok: true, data: { enabled: true } };
      }),
    };
    const runtime = {
      request: vi.fn(async (command) => {
        if (command?.type === "set_auto_compaction") order.push("rpc");
        return {};
      }),
    };
    mountGeneralSettings(container, {
      configGateway,
      runtime,
      getTarget: () => ({ workspaceId: "w", sessionId: "s", instanceId: "i" }),
    });
    document.getElementById("toggle-auto-compact").click();
    await vi.waitFor(() => expect(order).toEqual(["rpc", "config"]));
  });

  it("restores the toggle and skips the config write when the RPC fails", async () => {
    const configGateway = { call: vi.fn(async () => ({ ok: true, data: {} })) };
    const runtime = {
      request: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    };
    const errors = [];
    mountGeneralSettings(container, {
      configGateway,
      runtime,
      getTarget: () => ({}),
      onError: (error) => errors.push(error),
    });
    const button = document.getElementById("toggle-auto-compact");
    button.click();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(configGateway.call.mock.calls.map((call) => call[0])).not.toContain(
      "set_default_auto_compaction",
    );
    expect(button.classList.contains("on")).toBe(true);
    expect(button.getAttribute("aria-checked")).toBe("true");
  });

  it("provides setToggleState API", () => {
    const control = mountGeneralSettings(container);

    control.setToggleState("auto-compact", true);

    const autoCompactBtn = document.getElementById("toggle-auto-compact");
    expect(autoCompactBtn.classList.contains("on")).toBe(true);
    expect(uiStore.getItem("ui.settings.auto-compact")).toBeNull();
    expect(document.body.dataset.autoCompact).toBe("on");
  });

  it("handles missing toggle elements gracefully", () => {
    expect(() => mountGeneralSettings()).not.toThrow();
  });
});
