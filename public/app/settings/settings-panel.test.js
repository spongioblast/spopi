// ABOUTME: Tests settings panel hash routing.
// ABOUTME: Includes "writes #/settings/<tab> to the URL hash when a tab is opened".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSettingsPanel } from "./settings-panel.js";

function renderSettingsDom() {
  document.body.innerHTML = `
    <button id="settings-btn"></button>
    <button id="sidebar-extensions-btn"></button>
    <button id="sidebar-skills-btn"></button>
    <div class="settings-overlay hidden" id="settings-overlay"></div>
    <div class="settings-panel hidden" id="settings-panel">
      <aside class="settings-nav">
        <button class="settings-nav-item active" data-settings-tab="general">General</button>
        <button class="settings-nav-item" data-settings-tab="extensions">Packages</button>
        <button class="settings-nav-item" data-settings-tab="usage">Usage</button>
        <button class="settings-nav-item" data-settings-tab="configuration">Configuration</button>
        <button class="settings-nav-back" id="settings-close">Back</button>
      </aside>
      <section class="settings-content">
        <div class="settings-tab active" data-settings-panel="general"></div>
        <div class="settings-tab" data-settings-panel="extensions">
          <div class="settings-header">
            <h3>Extensions</h3>
          </div>
          <div class="settings-body">
            <div id="extensions-tabs" role="tablist">
              <button type="button" class="skills-page-tab" data-extensions-view="installed">Installed</button>
              <button type="button" class="skills-page-tab" data-extensions-view="recommended">Recommended</button>
              <button type="button" class="skills-page-tab" data-extensions-view="marketplace">Browse</button>
              <button type="button" class="skills-page-tab" data-extensions-view="resources">Resources</button>
            </div>
            <div id="extensions-recommended-host" hidden></div>
            <div class="settings-section" id="pkg-manager-section">
              <div id="pkg-manager-groups"></div>
            </div>
            <div class="settings-section" id="pkg-browse-section" hidden></div>
            <div class="settings-section" id="pkg-resources-section" hidden>
              <div id="settings-resources"></div>
            </div>
          </div>
        </div>
        <div class="settings-tab" data-settings-panel="usage"></div>
        <div class="settings-tab" data-settings-panel="configuration"></div>
      </section>
    </div>
  `;
}

describe("settings panel hash routing", () => {
  beforeEach(() => {
    renderSettingsDom();
    history.replaceState(null, "", "/app/workspaces/workspace-a/sessions/session-a");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState(null, "", "/app/workspaces/workspace-a/sessions/session-a");
  });

  it("writes #/settings/<tab> to the URL hash when a tab is opened", () => {
    const panel = mountSettingsPanel();
    panel.openSettings("usage");

    expect(window.location.hash).toBe("#/settings/usage");
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(false);
  });

  it("clears the hash when settings is closed", () => {
    const panel = mountSettingsPanel();
    panel.openSettings("general");
    panel.closeSettings();

    expect(window.location.hash).toBe("");
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(true);
  });

  it("reopens the settings panel on the saved tab when the hash is already present at load", () => {
    // Simulates a page refresh: the hash survives reload, so setup must
    // restore settings-open state instead of leaving the user on chat.
    window.location.hash = "#/settings/configuration";

    mountSettingsPanel();

    const panel = document.getElementById("settings-panel");
    expect(panel.classList.contains("hidden")).toBe(false);
    const configTab = document.querySelector('[data-settings-panel="configuration"]');
    expect(configTab.classList.contains("active")).toBe(true);
  });

  it("falls back to the general tab for an unknown hash tab key", () => {
    window.location.hash = "#/settings/does-not-exist";

    mountSettingsPanel();

    const generalTab = document.querySelector('[data-settings-panel="general"]');
    expect(generalTab.classList.contains("active")).toBe(true);
  });

  it("responds to hashchange events fired after setup (e.g. back/forward navigation)", () => {
    mountSettingsPanel();
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(true);

    window.location.hash = "#/settings/extensions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(false);
    const extensionsTab = document.querySelector('[data-settings-panel="extensions"]');
    expect(extensionsTab.classList.contains("active")).toBe(true);
  });

  it("opens sidebar Extensions as the installed-package dialog without changing the route", () => {
    mountSettingsPanel();

    document.getElementById("sidebar-extensions-btn").click();

    const panel = document.getElementById("settings-panel");
    expect(panel.classList.contains("resource-dialog")).toBe(true);
    expect(
      document.querySelector('[data-settings-panel="extensions"]').classList.contains("active"),
    ).toBe(true);
    expect(document.getElementById("pkg-manager-section").hidden).toBe(false);
    expect(document.getElementById("pkg-browse-section").hidden).toBe(true);
    expect(window.location.hash).toBe("");

    document.querySelector(".resource-dialog-header button").click();
    expect(panel.classList.contains("hidden")).toBe(true);
  });

  it("opens Settings → Extensions on installed packages with recommended above", () => {
    const panelApi = mountSettingsPanel();

    panelApi.openSettings("extensions");

    const panel = document.getElementById("settings-panel");
    expect(panel.classList.contains("resource-dialog")).toBe(false);
    expect(document.getElementById("pkg-manager-section").hidden).toBe(false);
    expect(document.getElementById("pkg-browse-section").hidden).toBe(true);
    expect(document.getElementById("extensions-recommended-host").hidden).toBe(true);

    document.querySelector('[data-extensions-view="marketplace"]').click();
    expect(document.getElementById("pkg-manager-section").hidden).toBe(true);
    expect(document.getElementById("pkg-browse-section").hidden).toBe(false);
    expect(document.getElementById("extensions-recommended-host").hidden).toBe(true);

    document.querySelector('[data-extensions-view="recommended"]').click();
    expect(document.getElementById("extensions-recommended-host").hidden).toBe(false);
    expect(document.getElementById("pkg-manager-section").hidden).toBe(true);
  });

  it("defaults to Recommended when first-run packages are missing", () => {
    const host = document.getElementById("extensions-recommended-host");
    host.dataset.firstRun = "1";
    const panelApi = mountSettingsPanel();
    panelApi.openSettings("extensions");
    expect(document.getElementById("extensions-recommended-host").hidden).toBe(false);
    expect(document.getElementById("pkg-manager-section").hidden).toBe(true);
  });

  it("reloads the override list each time Customizations opens", async () => {
    document
      .getElementById("settings-close")
      .insertAdjacentHTML(
        "beforebegin",
        '<button class="settings-nav-item" data-settings-tab="customizations">UI</button>',
      );
    document
      .querySelector(".settings-content")
      .insertAdjacentHTML(
        "beforeend",
        '<div class="settings-tab" data-settings-panel="customizations"></div>',
      );
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entries: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const panel = mountSettingsPanel();
      const calls = () =>
        fetchMock.mock.calls.filter(([url]) => url === "/api/ui/overrides").length;
      const mounted = calls();
      panel.openSettings("customizations");
      panel.closeSettings();
      panel.openSettings("customizations");
      expect(calls()).toBe(mounted + 2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens an old Skills hash on Packages → Resources", async () => {
    const configGateway = { call: vi.fn(async () => ({ ok: true, data: { items: [] } })) };
    const getTarget = () => ({ workspaceId: "workspace-a", sessionId: "session-a", instanceId: 1 });

    const panel = mountSettingsPanel({ configGateway, runtime: {}, getTarget });
    panel.openSettings("skills");

    expect(window.location.hash).toBe("#/settings/extensions");
    expect(
      document.querySelector('[data-settings-panel="extensions"]').classList.contains("active"),
    ).toBe(true);
    expect(document.getElementById("pkg-resources-section").hidden).toBe(false);
    expect(configGateway.call).toHaveBeenCalledWith("list_resource_inventory", { scope: "global" });
    await vi.waitFor(() => {
      expect(document.getElementById("settings-resources").textContent).toContain(
        "settings.resources.empty",
      );
    });
  });
});
