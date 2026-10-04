// ABOUTME: Tests SHELL_PANELS.
// ABOUTME: Includes "maps rail ids onto existing SPOPI sidebars".
import { describe, expect, it } from "vitest";
import { layoutPresetPatch } from "./layout-preset.js";
import { applyShellLayout, SHELL_PANELS } from "./shell-layout.js";

function layoutNodes() {
  return {
    app: document.querySelector(".app-layout"),
    workspace: document.querySelector(".workspace"),
    content: document.querySelector(".workspace-content"),
    main: document.querySelector(".main"),
  };
}

describe("SHELL_PANELS", () => {
  it("maps rail ids onto existing SPOPI sidebars", () => {
    expect(SHELL_PANELS.sessions).toBe("#sidebar");
    expect(SHELL_PANELS.files).toBe("#file-sidebar");
    expect(SHELL_PANELS.review).toBe("#review-sidebar");
    expect(SHELL_PANELS.search).toBeUndefined();
    expect(SHELL_PANELS.extensions).toBeUndefined();
  });
});

describe("applyShellLayout", () => {
  it("keeps workspace-content to three children and evicts stray side panels", () => {
    document.body.innerHTML = `
      <div class="app-layout">
        <aside id="sidebar"></aside>
        <div class="workspace">
          <div class="workspace-content">
            <div class="main"></div>
            <div id="file-preview-resizer"></div>
            <section id="file-preview-panel"></section>
            <aside id="file-sidebar"></aside>
            <div id="git-panel" class="git-panel hidden"></div>
            <div id="info-sidebar" class="file-sidebar info-sidebar app-side-panel collapsed"></div>
          </div>
        </div>
      </div>
    `;
    applyShellLayout({ layout: layoutNodes() });
    const workspaceContent = document.querySelector(".workspace-content");
    const ids = [...workspaceContent.children].map((node) => node.id || node.className);
    expect(workspaceContent.children).toHaveLength(3);
    expect(ids).toEqual(["pane-center", "spopi-chat-resizer", "main"]);
    expect(document.getElementById("info-sidebar").parentElement.id).toBe("spopi-sidebar-stack");
    expect(document.getElementById("sidebar").classList.contains("is-active-shell-panel")).toBe(
      true,
    );
    expect(document.querySelector(".app-layout").dataset.spopiShell).toBe("1");
    expect(applyShellLayout({ layout: layoutNodes() })).toBeNull();
  });

  it("does not create an extensions sidebar", () => {
    document.body.innerHTML = `
      <div class="app-layout">
        <aside id="sidebar"></aside>
        <div class="workspace">
          <div class="workspace-content">
            <div class="main"></div>
            <section id="file-preview-panel"></section>
          </div>
        </div>
      </div>
    `;
    const opened = [];
    applyShellLayout({ layout: layoutNodes(), onOpenExtensions: () => opened.push("extensions") });
    expect(document.getElementById("extensions-sidebar")).toBeNull();
    document.querySelector('[data-action="extensions"]')?.click();
    expect(opened).toEqual(["extensions"]);
  });

  it("opens a narrow drawer from the rail and Escape returns focus", () => {
    document.body.innerHTML = `
      <div class="app-layout">
        <aside id="sidebar"></aside>
        <div class="workspace">
          <div class="workspace-content">
            <div class="main"></div>
            <section id="file-preview-panel"></section>
          </div>
        </div>
      </div>
    `;
    applyShellLayout({ layout: layoutNodes() });
    document.body.dataset.layout = "narrow";
    const files = document.querySelector("[data-nav='files']");
    files.focus();
    files.click();
    expect(document.body.dataset.drawer).toBe("sidebar");
    expect(document.querySelector(".shell-scrim").hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.dataset.drawer).toBeUndefined();
    expect(document.activeElement).toBe(files);
  });

  it("showCenter opens the center drawer when narrow and leaves Focus", () => {
    document.body.innerHTML = `
      <div class="app-layout">
        <aside id="sidebar"></aside>
        <div class="workspace">
          <div class="workspace-content">
            <div class="main"></div>
            <section id="file-preview-panel"></section>
          </div>
        </div>
      </div>
    `;
    const persisted = [];
    const shell = applyShellLayout({
      layout: layoutNodes(),
      persistLayout: async (next) => {
        persisted.push(next);
      },
    });
    document.body.dataset.layout = "narrow";
    shell.applyHidden(layoutPresetPatch("focus"));
    expect(document.body.dataset.layoutPreset).toBe("focus");
    shell.showCenter();
    expect(document.body.dataset.drawer).toBe("center");
    expect(document.body.dataset.layoutPreset).toBe("workbench");
    expect(persisted.at(-1)).toMatchObject({
      focus: false,
      sidebarHidden: false,
      dockHidden: false,
    });
    shell.destroy();
    delete document.body.dataset.drawer;
    delete document.body.dataset.layout;
  });
});
