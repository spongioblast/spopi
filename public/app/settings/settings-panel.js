// ABOUTME: Opens the settings overlay and switches its tabs.
// ABOUTME: Tab order is SETTINGS_TABS.
import { t } from "../i18n/i18n.js";
import { mountNpmNotice } from "../packages/npm-notice.js";
import { mountSkillsInstallTab } from "../packages/packages-add-skills.js";
import { mountPackageBrowse } from "../packages/packages-browse.js";
import { mountPackageManager } from "../packages/packages-installed.js";
import { mountResourcesTab } from "../packages/packages-resources.js";
import { headerChromeRefs } from "../shell/chrome/chat.js";
import { sidebarChromeRefs } from "../shell/chrome/sidebar.js";
import { mountUpdateIndicator } from "../shell/update-indicator.js";
import { applyLoadingPlaceholder, clearLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { mountAppearanceSettings } from "./appearance-settings.js";
import { mountConfigurationSettings } from "./configuration-settings.js";
import { loadCostDashboard } from "./cost-dashboard.js";
import { mountCustomizationsSettings } from "./customizations-settings.js";
import { mountDependenciesSettings } from "./dependencies/dependencies-settings.js";
import { extensionsSettingsRefs, mountExtensionsSettings } from "./extensions-settings.js";
import { generalSettingsRefs, mountGeneralSettings } from "./general-settings.js";
import { mountModelsSettings } from "./models-settings.js";
import { mountPhoneSettings } from "./phone-settings.js";
import { mountTerminalSettings } from "./terminal-settings.js";
import { mountUsageSettings, usageSettingsRefs } from "./usage-settings.js";

/**
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: unknown,
 * }} ConfigCallResult
 *
 * @typedef {{
 *   call: (
 *     op: string,
 *     params?: Record<string, unknown>,
 *     options?: Record<string, unknown>
 *   ) => Promise<ConfigCallResult>,
 * }} ConfigGatewayLike
 *
 * @typedef {import("../packages/packages-add-skills.js").SkillInstallScan} SkillInstallScan
 *
 * @typedef {{
 *   refresh?: () => void | Promise<void>,
 *   destroy?: () => void,
 *   paint?: () => void,
 *   reload?: () => void,
 *   thinkingControl?: unknown,
 *   loadInlineConfigEditor?: () => void | Promise<void>,
 *   loadAgentsMdEditor?: () => void | Promise<void>,
 *   loadAppendSystemMdEditor?: () => void | Promise<void>,
 *   loadApiKeysPanel?: () => void | Promise<void>,
 *   loadInlineModelsEditor?: () => void | Promise<void>,
 *   loadOAuthCapability?: () => void | Promise<void>,
 *   hasUnsavedChanges?: () => boolean,
 *   confirmLeave?: () => Promise<boolean>,
 * }} OwnedSettingsPage
 *
 * @typedef {(
 *   root: Element,
 *   deps?: unknown
 * ) => OwnedSettingsPage} SettingsPageMount
 *
 * @typedef {{
 *   data?: {
 *     costDashboard: (workspaceId: string) => Promise<unknown>,
 *   } | null,
 *   getWorkspaceId?: (() => string | null | undefined) | null,
 *   control?: {
 *     pickSkillFolder: (workspaceId?: string | null) => Promise<{ path: string | null }>,
 *     openExternal?: (url: string) => Promise<unknown>,
    checkDependencies?: (options?: { quick?: boolean }) => Promise<{ npm?: { state?: string } }>,
 *   } | null,
 *   preferences?: unknown,
 *   terminal?: unknown,
 *   configGateway?: ConfigGatewayLike | null,
 *   oauthGateway?: unknown,
 *   onModelConfigurationChanged?: unknown,
 *   runtime?: unknown,
 *   getTarget?: (() => { sessionId?: string } | null | undefined) | null,
 *   onError?: ((message: unknown) => void) | null,
 *   notify?: ((payload: { type: string, title: string, message: string }) => void) | null,
 *   onRestarted?: unknown,
 *   onThinkingLevelChanged?: unknown,
 *   onCommandsReloaded?: (() => void | Promise<void>) | null,
 * }} SettingsPanelOptions
 *
 * @typedef {{
 *   __TAURI__?: {
 *     app?: {
 *       getVersion?: () => Promise<string | undefined>,
 *     },
 *   },
 * }} TauriGlobal
 */

export const SETTINGS_TABS = Object.freeze([
  { key: "general", labelKey: "settings.general" },
  { key: "appearance", labelKey: "settings.appearance" },
  { key: "terminal", labelKey: "settings.terminal.title" },
  { key: "extensions", labelKey: "settings.packages.title" },
  { key: "dependencies", labelKey: "settings.dependencies.title" },
  { key: "usage", labelKey: "settings.usage" },
  { key: "models", labelKey: "settings.models.title" },
  { key: "configuration", labelKey: "settings.configuration" },
  { key: "customizations", labelKey: "settings.customizations.title" },
  { key: "phone", labelKey: "settings.phone.title" },
]);

/** @type {ReadonlyArray<[string, SettingsPageMount]>} */
const OWNED_PAGES = Object.freeze([
  ["general", /** @type {SettingsPageMount} */ (mountGeneralSettings)],
  ["appearance", /** @type {SettingsPageMount} */ (mountAppearanceSettings)],
  ["terminal", /** @type {SettingsPageMount} */ (mountTerminalSettings)],
  ["extensions", /** @type {SettingsPageMount} */ (mountExtensionsSettings)],
  ["dependencies", /** @type {SettingsPageMount} */ (mountDependenciesSettings)],
  ["usage", /** @type {SettingsPageMount} */ (mountUsageSettings)],
  ["models", /** @type {SettingsPageMount} */ (mountModelsSettings)],
  ["configuration", /** @type {SettingsPageMount} */ (mountConfigurationSettings)],
  ["customizations", /** @type {SettingsPageMount} */ (mountCustomizationsSettings)],
  ["phone", /** @type {SettingsPageMount} */ (mountPhoneSettings)],
]);

/**
 * @param {HTMLElement} panel
 */
function ensureSettingsFrame(panel) {
  if (panel.querySelector(".settings-frame")) return;
  const frame = document.createElement("div");
  frame.className = "settings-frame";
  while (panel.firstChild) frame.append(panel.firstChild);
  panel.append(frame);
}

/**
 * @param {Element} panel
 */
function ensureSettingsNav(panel) {
  const nav = panel.querySelector(".settings-nav");
  if (!nav || nav.querySelector(".settings-nav-item")) return;
  const back = nav.querySelector(".settings-nav-back");
  const buttons = SETTINGS_TABS.map(({ key, labelKey }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = key === "general" ? "settings-nav-item active" : "settings-nav-item";
    button.dataset.settingsTab = key;
    button.dataset.i18n = labelKey;
    button.textContent = t(labelKey);
    return button;
  });
  if (back) back.before(...buttons);
  else nav.append(...buttons);
}

/**
 * @param {string} key
 * @param {SettingsPanelOptions} options
 * @returns {unknown}
 */
function pageDeps(key, options) {
  if (key === "phone") return { preferences: options.preferences, control: options.control };
  if (key === "dependencies") {
    return {
      preferences: options.preferences,
      control: options.control,
      configGateway: options.configGateway,
    };
  }
  if (key === "terminal") return { preferences: options.preferences, terminal: options.terminal };
  if (key === "appearance" || key === "general") return options;
  if (key === "configuration") return { configGateway: options.configGateway };
  if (key === "models") {
    return {
      configGateway: options.configGateway,
      oauthGateway: options.oauthGateway,
      onModelConfigurationChanged: options.onModelConfigurationChanged,
      openExternal: options.control?.openExternal?.bind(options.control),
    };
  }
  return undefined;
}
/**
 * @param {SettingsPanelOptions} [options]
 * @returns {Record<string, OwnedSettingsPage>}
 */
function mountOwnedSettingsPages(options = {}) {
  /** @type {Record<string, OwnedSettingsPage>} */
  const handles = {};
  for (const [key, mount] of OWNED_PAGES) {
    const root = document.querySelector(`[data-settings-panel="${key}"]`);
    if (!(root && root.childElementCount === 0)) continue;
    handles[key] = mount(root, pageDeps(key, options));
  }
  return handles;
}

/**
 * Wires the settings overlay panel for the native runtime: open/close, tab
 * switching, theme grid, the embedded pi version readout, the Usage tab (cost
 * dashboard), the Extensions tab (community package browse), and the
 * Configuration tab (API keys / model catalog + agent-config / models.json
 * editors). When `data` + `getWorkspaceId` are supplied the Usage tab loads
 * aggregated cost data from the native host on first open. `control` is a
 * HostControlGateway (or null) used by the Extensions tab to list/install/remove
 * packages via the embedded pi CLI. `configGateway` (or null) drives the
 * Configuration tab via the spopi-bridge extension. Both tabs are populated
 * lazily whenever they are shown.
 *
 * @param {{
 *   data?: {
 *     costDashboard: (workspaceId: string) => Promise<unknown>,
 *   } | null,
 *   getWorkspaceId?: (() => string | null | undefined) | null,
 *   control?: {
 *     pickSkillFolder: (workspaceId?: string | null) => Promise<{ path: string | null }>,
 *     checkDependencies?: (options?: { quick?: boolean }) => Promise<{ npm?: { state?: string } }>,
 *   } | null,
 *   preferences?: unknown,
 *   terminal?: unknown,
 *   configGateway?: ConfigGatewayLike | null,
 *   oauthGateway?: unknown,
 *   onModelConfigurationChanged?: unknown,
 *   runtime?: unknown,
 *   getTarget?: (() => { sessionId?: string } | null | undefined) | null,
 *   onError?: ((message: unknown) => void) | null,
 *   notify?: ((payload: { type: string, title: string, message: string }) => void) | null,
 *   onRestarted?: unknown,
 *   onThinkingLevelChanged?: unknown,
 *   onCommandsReloaded?: (() => void | Promise<void>) | null,
 * }} [options]
 */
export function mountSettingsPanel({
  data,
  getWorkspaceId,
  control,
  preferences,
  terminal,
  configGateway,
  oauthGateway,
  onModelConfigurationChanged,
  runtime,
  getTarget,
  onError,
  notify,
  onRestarted,
  onThinkingLevelChanged,
  onCommandsReloaded,
} = {}) {
  const panel = document.getElementById("settings-panel");
  const shellButtons = sidebarChromeRefs(document);
  const headerButtons = headerChromeRefs(document);
  const openBtn = shellButtons.settingsBtn;
  const closeBtn = document.getElementById("settings-close");
  const overlay = document.getElementById("settings-overlay");
  const extensionsBtn = shellButtons.extensionsBtn;
  const skillsBtn = shellButtons.skillsBtn;
  if (!panel || !openBtn) return;
  const settingsPanel = panel;
  ensureSettingsNav(settingsPanel);
  ensureSettingsFrame(settingsPanel);
  const ownedPages = mountOwnedSettingsPages({
    preferences,
    terminal,
    configGateway,
    oauthGateway,
    onModelConfigurationChanged,
    onError,
    runtime,
    getTarget,
    onThinkingLevelChanged,
    control,
  });
  const pages = {
    general: generalSettingsRefs(document.querySelector('[data-settings-panel="general"]')),
    extensions: extensionsSettingsRefs(
      document.querySelector('[data-settings-panel="extensions"]'),
    ),
    usage: usageSettingsRefs(document.querySelector('[data-settings-panel="usage"]')),
  };

  const resourceDialogHeader = document.createElement("header");
  resourceDialogHeader.className = "resource-dialog-header";
  const resourceDialogTitle = document.createElement("strong");
  const resourceDialogClose = document.createElement("button");
  resourceDialogClose.type = "button";
  resourceDialogClose.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost";
  resourceDialogClose.setAttribute("aria-label", t("shell.dialog.close"));
  resourceDialogClose.setAttribute("data-i18n-aria-label", "shell.dialog.close");
  resourceDialogClose.textContent = "×";
  resourceDialogHeader.append(resourceDialogTitle, resourceDialogClose);
  settingsPanel.prepend(resourceDialogHeader);

  const navItems = Array.from(document.querySelectorAll(".settings-nav-item"));
  const tabs = Array.from(document.querySelectorAll(".settings-tab"));
  const validTabKeys = new Set(
    navItems.flatMap((item) => {
      if (!("dataset" in item)) return [];
      const tabKey = /** @type {HTMLElement} */ (item).dataset.settingsTab;
      return tabKey ? [tabKey] : [];
    }),
  );
  const piVersionValue = pages.general.piVersion;
  const appVersionValue = pages.general.appVersion;
  const costDashboard = pages.usage.costDashboard;
  const packageBrowse = mountPackageBrowse(control, { notify });
  const updateIndicator = mountUpdateIndicator({
    buttonEl: headerButtons.packageUpdateIndicator,
    onOpen: () => openSettings("extensions"),
  });
  const packageManager = mountPackageManager({
    control,
    configGateway,
    data,
    notify,
    getWorkspaceId,
    getSessionId: () => getTarget?.()?.sessionId,
    onRestarted,
    onReloaded: onCommandsReloaded ?? undefined,
    onBrowseRevealed: () => setExtensionsView("marketplace"),
    // Mirror the update probe result onto the header pill so updates stay
    // visible after the settings panel is closed.
    /**
     * @param {number} count
     */
    onUpdatesChecked: (count) => updateIndicator.setCount(count),
  });
  const config = ownedPages.configuration;
  const modelsPage = ownedPages.models;
  const thinkingControl = ownedPages.general?.thinkingControl;
  /**
   * @param {{ type: string } & Record<string, unknown>} command
   */
  const skillsRpc = async (command) => {
    if (!configGateway) {
      return { success: false, error: t("settings.skills.loadFailed") };
    }
    const { type, ...params } = command;
    const result = await configGateway.call(type, params);
    if (!result?.ok) {
      return { success: false, error: result?.error || t("settings.skills.loadFailed") };
    }
    return { success: true, data: result.data };
  };
  /**
   * @param {string} message
   */
  const showSkillsSuccess = notify
    ? /** @param {string} message */ (message) =>
        notify({ type: "success", title: t("status.saved"), message })
    : undefined;
  /**
   * @param {string} message
   */
  const showSkillsError = notify
    ? /** @param {string} message */ (message) =>
        notify({ type: "error", title: t("settings.skills.saveFailed"), message })
    : /** @param {string} message */ (message) => onError?.(message);

  /**
   * @param {string} op
   * @param {Record<string, unknown>} params
   */
  const configData = async (op, params) => {
    if (!configGateway) throw new Error(t("settings.skills.loadFailed"));
    const result = await configGateway.call(op, params);
    if (!result?.ok) throw new Error(result?.error || t("settings.skills.loadFailed"));
    return result.data;
  };
  const installContainer = pages.extensions.installSkills;
  const installTab = control
    ? mountSkillsInstallTab({
        container: /** @type {HTMLElement} */ (installContainer),
        transport: {
          pickSkillFolder: (workspaceId) => control.pickSkillFolder(workspaceId),
          scanSkillFolder: async (path) =>
            /** @type {SkillInstallScan} */ (await configData("scan_skill_folder", { path })),
          addSkillFolder: async (request) =>
            /** @type {SkillInstallScan["result"]} */ (
              await configData("add_skill_folder", request)
            ),
        },
        getWorkspaceId: getWorkspaceId ? () => getWorkspaceId() ?? null : undefined,
        isProjectTrusted: () => true,
        showSuccess: showSkillsSuccess,
        showError: showSkillsError,
        onReloaded: onCommandsReloaded ?? undefined,
      })
    : null;
  const resourcesTab = mountResourcesTab({
    container: pages.extensions.resources,
    installContainer,
    rpcCommand: skillsRpc,
    onAddSkills: () => installTab?.activate?.(),
    showSuccess: showSkillsSuccess,
    showError: showSkillsError,
    onReloaded: onCommandsReloaded ?? undefined,
  });
  let usageLoaded = false;

  function loadUsage() {
    if (usageLoaded || !costDashboard || !data || !getWorkspaceId) return;
    usageLoaded = true;
    const dataApi = data;
    const workspaceId = getWorkspaceId;
    void loadCostDashboard(
      costDashboard,
      /** @type {Parameters<typeof loadCostDashboard>[1]} */ ({
        data: dataApi,
        getWorkspaceId: workspaceId,
      }),
    );
  }

  function loadConfiguration() {
    if (!config?.loadInlineConfigEditor) return;
    const page = /** @type {{
      loadInlineConfigEditor: () => void | Promise<void>,
      loadAgentsMdEditor: () => void | Promise<void>,
      loadAppendSystemMdEditor: () => void | Promise<void>,
    }} */ (config);
    void page.loadInlineConfigEditor();
    void page.loadAgentsMdEditor();
    void page.loadAppendSystemMdEditor();
  }

  function loadModels() {
    if (!modelsPage?.loadApiKeysPanel) return;
    const page = /** @type {{
      loadApiKeysPanel: () => void | Promise<void>,
      loadInlineModelsEditor: () => void | Promise<void>,
      loadOAuthCapability: () => void | Promise<void>,
    }} */ (modelsPage);
    void page.loadApiKeysPanel();
    void page.loadInlineModelsEditor();
    // Preload the OAuth capability surface so Codex renders with its login
    // entry immediately instead of probing on first click.
    void page.loadOAuthCapability();
  }

  function defaultExtensionsView() {
    const host = pages.extensions.recommendedHost;
    return host?.dataset.firstRun === "1" ? "recommended" : "installed";
  }

  /**
   * @param {string} [mode]
   */
  function setExtensionsView(mode) {
    const next =
      typeof mode === "string" &&
      ["installed", "recommended", "marketplace", "resources"].includes(mode)
        ? mode
        : defaultExtensionsView();
    const managerSection = pages.extensions.managerSection;
    const browseSection = pages.extensions.browseSection;
    const recommendedHost = pages.extensions.recommendedHost;
    const resourcesSection = pages.extensions.resourcesSection;
    if (managerSection) managerSection.hidden = next !== "installed";
    if (recommendedHost) recommendedHost.hidden = next !== "recommended";
    if (browseSection) browseSection.hidden = next !== "marketplace";
    if (resourcesSection) resourcesSection.hidden = next !== "resources";
    for (const tab of pages.extensions.tabButtons) {
      if (!("dataset" in tab)) continue;
      const tabEl = /** @type {HTMLElement} */ (tab);
      const active = tabEl.dataset.extensionsView === next;
      tabEl.classList.toggle("active", active);
      tabEl.setAttribute("aria-selected", String(active));
    }
    if (next === "marketplace") void packageBrowse.load();
    if (next === "installed") void packageManager.load(true);
    if (next === "resources") void resourcesTab.activate();
  }

  async function refreshNpmNotice() {
    const host = pages.extensions.recommendedHost;
    if (!host || !control?.checkDependencies) return;
    try {
      const report = await control.checkDependencies({ quick: true });
      mountNpmNotice(/** @type {HTMLElement} */ (host), {
        report,
        openSettings: (tab) => openSettings(tab),
      });
    } catch {
      // Packages still open when the npm check cannot run.
    }
  }

  /**
   * @param {string} [tabKey]
   * @param {string} [extensionsView]
   */
  function selectTab(tabKey = "general", extensionsView) {
    const target =
      tabKey === "auth" ? "configuration" : tabKey === "skills" ? "extensions" : tabKey;
    for (const item of navItems) {
      if (!("dataset" in item)) continue;
      const itemEl = /** @type {HTMLElement} */ (item);
      itemEl.classList.toggle("active", itemEl.dataset.settingsTab === target);
    }
    for (const tab of tabs) {
      if (!("dataset" in tab)) continue;
      const tabEl = /** @type {HTMLElement} */ (tab);
      tabEl.classList.toggle("active", tabEl.dataset.settingsPanel === target);
    }

    if (target === "appearance") void ownedPages.appearance?.refresh?.();
    if (target === "terminal") void ownedPages.terminal?.refresh?.();
    if (target === "usage") loadUsage();
    if (target === "extensions") {
      setExtensionsView(
        extensionsView || (tabKey === "skills" ? "resources" : defaultExtensionsView()),
      );
      void refreshNpmNotice();
    }
    if (target === "dependencies") void ownedPages.dependencies?.reload?.();
    if (target === "configuration") loadConfiguration();
    if (target === "models") loadModels();
    if (target === "customizations") void ownedPages.customizations?.refresh?.();
  }

  async function loadPiVersion() {
    if (!piVersionValue) return;
    applyLoadingPlaceholder(piVersionValue, {
      label: t("settings.config.loading"),
    });
    try {
      const response = await fetch("/health");
      const health = /** @type {{ piVersion?: string }} */ (await response.json());
      clearLoadingPlaceholder(piVersionValue);
      piVersionValue.textContent = health?.piVersion || "Unavailable";
    } catch {
      clearLoadingPlaceholder(piVersionValue);
      piVersionValue.textContent = t("sidebar.unavailable");
    }
  }

  async function loadAppVersion() {
    if (!appVersionValue) return;
    try {
      const tauri = /** @type {TauriGlobal} */ (globalThis);
      const version = await tauri.__TAURI__?.app?.getVersion?.();
      clearLoadingPlaceholder(appVersionValue);
      appVersionValue.textContent = version ? `v${version}` : "Unavailable";
    } catch {
      clearLoadingPlaceholder(appVersionValue);
      appVersionValue.textContent = t("sidebar.unavailable");
    }
  }

  // Persist "settings is open, on tab X" to the URL hash (independent of the
  // path-based session route) so a page refresh — or opening a link that
  // still has the hash from before a reload — reopens the same settings tab
  // instead of silently dropping back to the chat view.
  /**
   * @param {unknown} tabKey
   * @returns {string}
   */
  function normalizeSettingsTabKey(tabKey) {
    const rawTabKey = typeof tabKey === "string" ? tabKey : "general";
    const decodedTabKey = decodeURIComponent(rawTabKey || "general");
    const aliased = decodedTabKey === "auth" ? "configuration" : decodedTabKey;
    const normalizedTabKey = aliased === "skills" ? "extensions" : aliased;
    return validTabKeys.has(normalizedTabKey) ? normalizedTabKey : "general";
  }

  /**
   * @param {unknown} tabKey
   * @returns {string}
   */
  function settingsHashForTab(tabKey) {
    return `#/settings/${encodeURIComponent(normalizeSettingsTabKey(tabKey))}`;
  }

  /**
   * @param {unknown} tabKey
   */
  function updateSettingsHash(tabKey) {
    const nextHash = settingsHashForTab(tabKey);
    if (window.location.hash === nextHash) return;
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }

  function clearSettingsHash() {
    if (!window.location.hash.startsWith("#/settings")) return;
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  /**
   * @param {boolean} enabled
   */
  function setResourceDialogMode(enabled) {
    settingsPanel.classList.toggle("resource-dialog", enabled);
    overlay?.classList.toggle("resource-dialog-overlay", enabled);
  }

  /**
   * @param {string} [tabKey]
   * @param {{ updateHash?: boolean }} [options]
   */
  function openSettings(tabKey = "general", { updateHash = true } = {}) {
    const showResources = tabKey === "skills";
    const normalizedTabKey = normalizeSettingsTabKey(tabKey);
    setResourceDialogMode(false);
    if (updateHash) updateSettingsHash(normalizedTabKey);
    settingsPanel.classList.remove("hidden");
    selectTab(normalizedTabKey, showResources ? "resources" : undefined);
    ownedPages.appearance?.paint?.();
    ownedPages.general?.reload?.();
    void loadPiVersion();
    void loadAppVersion();
  }

  /**
   * @param {string} [tabKey]
   */
  function openResourceDialog(tabKey) {
    clearSettingsHash();
    setResourceDialogMode(true);
    resourceDialogTitle.textContent = t("settings.packages.title");
    settingsPanel.classList.remove("hidden");
    selectTab("extensions", tabKey === "skills" ? "resources" : undefined);
  }

  /**
   * @param {{ clearHash?: boolean }} [options]
   */
  function closeSettings({ clearHash = true } = {}) {
    if (clearHash) clearSettingsHash();
    const wasOpen = !settingsPanel.classList.contains("hidden");
    settingsPanel.classList.add("hidden");
    setResourceDialogMode(false);
    if (wasOpen) document.dispatchEvent(new CustomEvent("spopi-settings-closed"));
  }

  /**
   * Unsaved provider or model edits ask before Settings closes or the tab changes.
   * @param {() => void} proceed
   */
  function leaveSettingsPage(proceed) {
    const page = modelsPage;
    if (
      settingsPanel.classList.contains("hidden") ||
      !page?.hasUnsavedChanges?.() ||
      !page.confirmLeave
    ) {
      proceed();
      return;
    }
    void page.confirmLeave().then((ok) => {
      if (ok) proceed();
    });
  }

  function requestCloseSettings() {
    leaveSettingsPage(() => closeSettings());
  }

  function restoreFromHash() {
    const route = window.location.hash.slice(1);
    if (route === "/settings" || route.startsWith("/settings/")) {
      const tabKey = route.split("/")[2] || "general";
      openSettings(tabKey, { updateHash: false });
      return;
    }
    if (!settingsPanel.classList.contains("hidden")) closeSettings({ clearHash: false });
  }

  for (const tab of pages.extensions.tabButtons) {
    tab.addEventListener("click", () => {
      if (!("dataset" in tab)) return;
      setExtensionsView(/** @type {HTMLElement} */ (tab).dataset.extensionsView);
    });
  }
  openBtn.addEventListener("click", () => openSettings());
  extensionsBtn?.addEventListener("click", () => openResourceDialog("extensions"));
  skillsBtn?.addEventListener("click", () => openResourceDialog("skills"));
  resourceDialogClose.addEventListener("click", requestCloseSettings);
  closeBtn?.addEventListener("click", requestCloseSettings);
  overlay?.addEventListener("click", requestCloseSettings);
  for (const item of navItems) {
    item.addEventListener("click", () => {
      if (!("dataset" in item)) return;
      const itemEl = /** @type {HTMLElement} */ (item);
      const go = () => {
        selectTab(itemEl.dataset.settingsTab);
        updateSettingsHash(itemEl.dataset.settingsTab);
      };
      if (itemEl.classList.contains("active")) go();
      else leaveSettingsPage(go);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || settingsPanel.classList.contains("hidden")) return;
    if (event.defaultPrevented) return;
    requestCloseSettings();
  });
  window.addEventListener("hashchange", restoreFromHash);
  restoreFromHash();

  return { openSettings, closeSettings, thinkingControl };
}
