// ABOUTME: Tests header open app.
// ABOUTME: Includes "shows VS Code when installed and opens the workspace with its app name".
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetUiStore, uiStore } from "../storage/ui-store.js";
import { mountHeaderOpenApp } from "./header-open-app.js";

function renderControl() {
  document.body.innerHTML = `
    <span class="header-open-app hidden" id="header-open-app">
      <button id="header-open-app-btn"><span id="header-open-app-logo"></span></button>
      <button id="header-open-app-toggle"></button>
      <div class="header-open-app-menu hidden" id="header-open-app-menu"></div>
    </span>
  `;
}

describe("header open app", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    resetUiStore();
  });

  it("shows VS Code when installed and opens the workspace with its app name", async () => {
    renderControl();
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { path: "/tmp/spopi" } }),
    };
    const control = {
      listInstalledApps: vi
        .fn()
        .mockResolvedValue([{ id: "vscode", label: "VS Code", appName: "Visual Studio Code" }]),
      openInApp: vi.fn().mockResolvedValue(undefined),
    };

    expect(mountHeaderOpenApp({ data, control, workspaceId: "workspace-a" })).toBe(true);
    await vi.waitFor(() =>
      expect(document.getElementById("header-open-app").classList.contains("hidden")).toBe(false),
    );

    expect(data.workspaceInfo).toHaveBeenCalledWith("workspace-a");
    expect(document.getElementById("header-open-app-btn").title).toContain("VS Code");
    document.getElementById("header-open-app-btn").click();
    await vi.waitFor(() => expect(control.openInApp).toHaveBeenCalled());
    expect(control.openInApp).toHaveBeenCalledWith("/tmp/spopi", {
      appName: "Visual Studio Code",
      command: null,
    });
  });

  it("renders the app menu and uses the selected app", async () => {
    renderControl();
    const control = {
      listInstalledApps: vi.fn().mockResolvedValue([
        { id: "vscode", label: "VS Code", appName: "Visual Studio Code" },
        { id: "cursor", label: "Cursor", appName: "Cursor" },
      ]),
      openInApp: vi.fn().mockResolvedValue(undefined),
    };

    mountHeaderOpenApp({
      data: { workspaceInfo: vi.fn().mockResolvedValue({ info: { path: "/tmp/spopi" } }) },
      control,
      workspaceId: "workspace-a",
    });
    await vi.waitFor(() =>
      expect(document.getElementById("header-open-app").classList.contains("hidden")).toBe(false),
    );

    document.getElementById("header-open-app-toggle").click();
    const items = [...document.querySelectorAll(".header-open-app-menu-item")];
    expect(items.map((item) => item.textContent.trim())).toEqual(["VS Code", "Cursor"]);
    items[1].click();

    await vi.waitFor(() => expect(control.openInApp).toHaveBeenCalled());
    expect(control.openInApp).toHaveBeenCalledWith("/tmp/spopi", {
      appName: "Cursor",
      command: null,
    });
    expect(uiStore.getItem("ui.shell.openApp")).toBe("cursor");
  });

  it("keeps the control usable when workspace git metadata is unavailable", async () => {
    renderControl();
    const onError = vi.fn();
    mountHeaderOpenApp({
      data: {
        workspaceInfo: vi.fn().mockResolvedValue({
          info: { path: "/tmp/spopi", isGit: false },
        }),
      },
      control: {
        listInstalledApps: vi
          .fn()
          .mockResolvedValue([{ id: "vscode", label: "VS Code", appName: "Visual Studio Code" }]),
        openInApp: vi.fn().mockResolvedValue(undefined),
      },
      workspaceId: "workspace-a",
      onError,
    });
    await vi.waitFor(() =>
      expect(document.getElementById("header-open-app").classList.contains("hidden")).toBe(false),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not report a workspaceInfo failure as a host error", async () => {
    renderControl();
    const onError = vi.fn();
    mountHeaderOpenApp({
      data: {
        workspaceInfo: vi.fn().mockRejectedValue(new Error("program not found")),
      },
      control: {
        listInstalledApps: vi
          .fn()
          .mockResolvedValue([{ id: "vscode", label: "VS Code", appName: "Visual Studio Code" }]),
        openInApp: vi.fn().mockResolvedValue(undefined),
      },
      workspaceId: "workspace-a",
      onError,
    });
    await vi.waitFor(() =>
      expect(document.getElementById("header-open-app").classList.contains("hidden")).toBe(true),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});
