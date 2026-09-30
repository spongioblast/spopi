// ABOUTME: Tests createSpopiWorkbench contracts.
// ABOUTME: Includes "loads ui.layout without writing first-run into it".
import { describe, expect, it, vi } from "vitest";
import { FIRST_RUN_KEY } from "../packages/packages-recommended.js";
import { createSpopiWorkbench } from "./mount-workbench.js";
import { paintStatusFooter } from "./status-footer.js";

function mountDom() {
  document.body.innerHTML = `
    <div class="app-layout">
      <header class="header"><div class="header-right"></div></header>
      <aside id="sidebar"><div class="sidebar-footer"></div></aside>
      <div id="extensions-recommended-host"></div>
      <div class="workspace">
        <div class="workspace-content">
          <div class="main">
            <form id="chat-form"><div class="composer-card"><div class="composer-toolbar"></div></div></form>
            <div class="input-area"></div>
          </div>
          <section id="file-preview-panel" class="collapsed"></section>
        </div>
      </div>
    </div>
  `;
}

describe("createSpopiWorkbench contracts", () => {
  it("loads ui.layout without writing first-run into it", async () => {
    mountDom();
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn(async (key) => (key === "ui.layout" ? { sidebarWidth: 240 } : null));
    const workbench = createSpopiWorkbench({});
    workbench.attachPreferences({ get, set });
    await Promise.resolve();
    await Promise.resolve();
    expect(get).toHaveBeenCalledWith("ui.layout");
    expect(
      set.mock.calls.every((call) => call[0] !== "ui.layout" || call[1]?.[FIRST_RUN_KEY] == null),
    ).toBe(true);
  });

  it("opens Cockpit when the header status is clicked", () => {
    mountDom();
    document
      .querySelector(".header")
      .insertAdjacentHTML(
        "afterbegin",
        `<div class="status"><span id="status-text">Connected</span></div>`,
      );
    createSpopiWorkbench({});
    const dock = document.getElementById("spopi-dock");
    dock.setTab("terminal");
    document.querySelector(".status").click();
    expect(dock.dataset.activeTab).toBe("cockpit");
    expect(document.body.classList.contains("dock-hidden")).toBe(false);
  });

  it("shows install progress and then marks the package installed", async () => {
    mountDom();
    /** @type {Array<{ source: string, packageName: string }>} */
    let packages = [];
    /** @type {((value?: unknown) => void) | undefined} */
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    createSpopiWorkbench({
      getPackages: () => packages,
      installPackage: async (source) => {
        await pending;
        packages = [...packages, { source, packageName: source.replace(/^npm:/, "") }];
      },
    });
    const button = document.querySelector("[data-package='@pify/worktree'] button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing install button");
    button.click();
    expect(
      document.querySelector("[data-package='@pify/worktree'] [role='progressbar']"),
    ).toBeTruthy();
    release?.();
    await vi.waitFor(() => {
      const card = document.querySelector("[data-package='@pify/worktree']");
      expect(card?.classList.contains("is-installed")).toBe(true);
      expect(card?.querySelector("[role='progressbar']")).toBeNull();
    });
  });

  it("keeps the install button and shows the host error when install fails", async () => {
    mountDom();
    createSpopiWorkbench({
      getPackages: () => [],
      installPackage: async () => {
        throw new Error("npm is not installed");
      },
    });
    const button = document.querySelector("[data-package='@pify/worktree'] button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing install button");
    button.click();
    await vi.waitFor(() => {
      const card = document.querySelector("[data-package='@pify/worktree']");
      expect(card?.querySelector(".pkg-install-error")?.textContent).toBe("npm is not installed");
      expect(card?.querySelector("button")?.disabled).toBe(false);
    });
  });

  it("installs packages through installPackage, not chat /install", () => {
    mountDom();
    const installPackage = vi.fn();
    const sendPrompt = vi.fn();
    createSpopiWorkbench({
      installPackage,
      sendPrompt,
      getPackages: () => [],
    });
    document.querySelector(".extensions-recommended-card button, .ui-button")?.click();
    expect(sendPrompt).not.toHaveBeenCalledWith(expect.stringMatching(/^\/install /));
  });

  it("hides the first-run card after the dismissed key loads", async () => {
    mountDom();
    const get = vi.fn(async (key) => (key === FIRST_RUN_KEY ? true : null));
    const workbench = createSpopiWorkbench({ getPackages: () => [] });
    expect(document.querySelector(".extensions-first-run")).toBeTruthy();
    workbench.attachPreferences({ get, set: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector(".extensions-first-run")).toBeNull();
  });

  it("loads thinking budgets from spopi-config and never posts a slash command", async () => {
    mountDom();
    const sendPrompt = vi.fn();
    const configCall = vi.fn(async (op) => {
      if (op === "get_thinking_budgets") {
        return { ok: true, data: { level: "high", budgets: { high: 32768 } } };
      }
      return { ok: true };
    });
    const workbench = createSpopiWorkbench({
      sendPrompt,
      configCall,
      getModelInfo: () => ({
        provider: "local-8000",
        thinkingLevel: "high",
        thinkingBudgetField: "thinking_token_budget",
      }),
    });
    await workbench.loadThinkingBudgets();
    const button = document.querySelector(".metrics-thinking");
    expect(button?.textContent).toContain("32,768");
    button.click();
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(configCall).toHaveBeenCalledWith("set_thinking_budget", {
      level: "high",
      tokens: 49152,
    });
  });

  it("rail Extensions opens Settings on the extensions tab once", () => {
    mountDom();
    const settingsBtn = document.createElement("button");
    settingsBtn.id = "settings-btn";
    const click = vi.fn();
    settingsBtn.addEventListener("click", click);
    document.body.append(settingsBtn);
    const onOpenSettings = vi.fn();
    createSpopiWorkbench({ onOpenSettings });
    document.querySelector('[data-action="extensions"]').click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith("extensions");
    expect(click).not.toHaveBeenCalled();
  });

  it("setChangedFiles and updateDockStatus paint live surfaces", () => {
    mountDom();
    const workbench = createSpopiWorkbench({
      getPackages: () => [{ source: "npm:pi-workspace-history" }],
    });
    workbench.refreshPackages();
    workbench.setChangedFiles([{ path: "src/app.js" }]);
    expect(document.querySelector("#spopi-dock-tab-changes")).toBeNull();
    workbench.updateDockStatus({ tokPerSec: 40, ttftMs: 210, cachePct: 80, kvPct: 12 });
    expect(document.getElementById("dock-status")?.textContent).toContain("40 t/s");
    expect(document.getElementById("header-metrics")?.textContent).toContain("40 t/s");
  });

  it("shows pi-lens-lsp in the Problems header instead of the dock strip", () => {
    mountDom();
    createSpopiWorkbench({});
    paintStatusFooter({ build: "running", "pi-lens-lsp": "LSP Inactive" });
    const strip = document.querySelector(".spopi-dock-statuses");
    expect(strip?.querySelector('[data-status-key="build"]')).not.toBeNull();
    expect(strip?.querySelector('[data-status-key="pi-lens-lsp"]')).toBeNull();
    const header = document.querySelector("#spopi-dock-problems .problems-language-status");
    expect(header?.hidden).toBe(false);
    expect(header?.textContent).toBe("dock.languageServers.none");
  });
});
