// ABOUTME: Tests app updater sidebar action.
// ABOUTME: Includes "installs the available update directly from the sidebar pill".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAppUpdater } from "./app-updater.js";

function renderUpdaterDom() {
  document.body.innerHTML = `
    <span id="setting-update-status"></span>
    <button id="btn-check-updates"></button>
    <button id="sidebar-update-btn" class="hidden">Update</button>
  `;
}

describe("app updater sidebar action", () => {
  beforeEach(() => {
    renderUpdaterDom();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "__TAURI__");
  });

  it("installs the available update directly from the sidebar pill", async () => {
    const downloadAndInstall = vi.fn(async () => undefined);
    const relaunch = vi.fn(async () => undefined);
    const openSettings = vi.fn();

    globalThis.__TAURI__ = {
      process: { relaunch },
      updater: {
        check: vi.fn(async () => ({ version: "9.9.9", downloadAndInstall })),
      },
    };

    mountAppUpdater({ settingsPanel: { openSettings } });

    const sidebarButton = document.getElementById("sidebar-update-btn");
    await vi.waitFor(() => expect(sidebarButton.classList.contains("hidden")).toBe(false));

    sidebarButton.click();

    await vi.waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("says no release is published when the check is a 404", async () => {
    globalThis.__TAURI__ = {
      updater: {
        check: vi.fn(async () => {
          throw new Error("404 Not Found");
        }),
      },
    };
    const updater = mountAppUpdater();
    const status = document.getElementById("setting-update-status");
    await vi.waitFor(async () => {
      await updater?.checkNow();
      expect(status?.textContent).toContain("updater.noReleaseYet");
    });
  });
});
