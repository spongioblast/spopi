// ABOUTME: Tests the recommended package cards.
// ABOUTME: A failed package is the only card that says to update Pi.
import { describe, expect, it } from "vitest";
import { mountExtensionsPanel } from "./packages-page.js";

describe("mountExtensionsPanel", () => {
  it("renders the recommended rows with why copy and Install vs Installed", () => {
    const root = document.createElement("div");
    root.id = "extensions-recommended-host";
    const installed = [];
    mountExtensionsPanel(root, {
      packages: [{ source: "npm:pi-workspace-history" }],
      onInstall: (source) => installed.push(source),
    });
    const rows = [...root.querySelectorAll(".extensions-recommended-card")];
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toContain("packages.recommended.checkpoints.why");
    expect(rows[0].querySelector("button")?.disabled).toBe(true);
    expect(rows[1].querySelector("button")?.disabled).toBe(false);
    rows[1].querySelector("button")?.click();
    expect(installed[0]).toMatch(/^npm:pi-lens/);
  });

  it("remounts only the recommended host and leaves the package manager alone", () => {
    document.body.innerHTML = `
      <div class="settings-tab" data-settings-panel="extensions">
        <div class="settings-body">
          <div id="extensions-recommended-host"></div>
          <div id="pkg-manager-section"></div>
        </div>
      </div>
    `;
    const host = document.getElementById("extensions-recommended-host");
    mountExtensionsPanel(host, { packages: [] });
    mountExtensionsPanel(host, { packages: [{ source: "npm:pi-lens" }] });
    expect(document.getElementById("pkg-manager-section")).toBeTruthy();
    expect(
      document.querySelector('[data-settings-panel="extensions"] #pkg-manager-section'),
    ).toBeTruthy();
    expect(document.querySelector("#spopi-sidebar-stack .extensions-recommended-card")).toBeNull();
  });

  it("exposes missingCount and paints the recommended tab badge", () => {
    document.body.innerHTML = `<span id="extensions-missing-badge" hidden></span><div id="host"></div>`;
    const mounted = mountExtensionsPanel(document.getElementById("host"), {
      packages: [{ source: "npm:pi-workspace-history" }],
    });
    expect(mounted.missingCount).toBe(6);
    const badge = document.getElementById("extensions-missing-badge");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("6");
  });

  it("shows a first-run card that installs missing packages", () => {
    const root = document.createElement("div");
    const installed = [];
    mountExtensionsPanel(root, {
      packages: [],
      onInstall: (source) => installed.push(source),
    });
    root.querySelector(".extensions-first-run .ui-button")?.click();
    expect(installed.length).toBeGreaterThan(0);
    expect(installed[0]).toMatch(/^npm:/);
  });

  it("shows a progress bar while a recommended package is installing", () => {
    const root = document.createElement("div");
    mountExtensionsPanel(root, {
      packages: [],
      installing: ["npm:@pify/worktree"],
      progress: { done: 0, total: 1 },
    });
    const card = root.querySelector('[data-package="@pify/worktree"]');
    const bar = card?.querySelector("[role='progressbar']");
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("aria-label")).toBe("recommended.installing");
    expect(card?.querySelector("button")?.disabled).toBe(true);
    expect(card?.classList.contains("is-installed")).toBe(false);
  });

  it("shows the install error on the card after a failed install", () => {
    const root = document.createElement("div");
    mountExtensionsPanel(root, {
      packages: [],
      installErrors: { "npm:@pify/worktree": "npm is not installed" },
    });
    const card = root.querySelector('[data-package="@pify/worktree"]');
    expect(card?.querySelector(".pkg-install-error")?.textContent).toBe("npm is not installed");
    expect(card?.querySelector("button")?.disabled).toBe(false);
  });

  it("installs every missing package from the first-run button", () => {
    const root = document.createElement("div");
    /** @type {string[] | undefined} */
    let batch;
    mountExtensionsPanel(root, {
      packages: [{ source: "npm:pi-lens" }],
      onInstallAll: (sources) => {
        batch = sources;
      },
    });
    root.querySelector(".extensions-first-run .ui-button")?.click();
    expect(batch?.[0]).toMatch(/^npm:/);
    expect(batch).not.toContain("npm:pi-lens");
  });

  it("shows Update Pi only on a failed package", () => {
    const root = document.createElement("div");
    mountExtensionsPanel(root, {
      packages: [{ source: "npm:pi-lens" }],
      health: [
        { name: "pi-lens", state: "failed", error: "load failed" },
        { name: "pi-workspace-history", state: "loaded" },
      ],
    });
    const failed = root.querySelector('[data-package="pi-lens"]');
    const loaded = root.querySelector('[data-package="pi-workspace-history"]');
    expect(failed?.querySelector(".extensions-pi-hint")?.textContent).toBe("recommended.updatePi");
    expect(loaded?.querySelector(".extensions-pi-hint")).toBeNull();
    expect(failed?.getAttribute("title")).toBe("load failed");
  });
});
