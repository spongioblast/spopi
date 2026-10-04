// ABOUTME: SPOPI workbench composition: shell, dock, center tabs, packages, live chat chrome.
// ABOUTME: Empty callbacks are not left here — each mount gets a real host contract; parts live in workbench-*.js.

import { mountContextInspector } from "../chat/context-inspector-tab.js";
import { mountLiveStrip } from "../chat/live-strip.js";
import {
  appendAssistantTurnMeta,
  appendUserTurnActions,
  assistantTurnMeta,
  userTurnActions,
} from "../chat/turn-meta.js";
import {
  createDockHost,
  dockStatusElement,
  dockStatusFromSnapshot,
  renderDockStatus,
} from "../dock/dock.js";
import { mountProblemsDock } from "../dock/problems-dock.js";
import { mountCenterTabs } from "../editor/center-tabs.js";
import { mountHomePane } from "../editor/home-pane.js";
import { closeReview } from "../editor/review-pane.js";
import { mountFileSearch } from "../files/file-search.js";
import { searchWorkspace } from "../files/search-model.js";
import { t } from "../i18n/i18n.js";
import { connectCacheWarming } from "../metrics/cache-warming-control.js";
import { MetricsOverlay } from "../metrics/metrics-overlay.js";
import { createAffordances, FIRST_RUN_KEY } from "../packages/packages-recommended.js";
import { mountRunFileButton } from "../terminal/run-file.js";
import { composerChromeRefs } from "./chrome/composer.js";
import { filePreviewRefs } from "./chrome/file-preview.js";
import { fileSidebarRefs } from "./chrome/file-sidebar.js";
import { sidebarChromeRefs } from "./chrome/sidebar.js";
import { mountHeaderChrome, paintHeaderMetrics } from "./header-chrome.js";
import { applyLayoutVars, normalizeLayout } from "./layout-prefs.js";
import { applyShellLayout } from "./shell-layout.js";
import { registerSpopiCommands } from "./spopi-commands.js";
import { registerProblemsLanguageStatus } from "./status-footer.js";
import { connectEditorSelection, mountWorkbenchComposer } from "./workbench-composer.js";
import { asClickable, asStatusButton, asSteerInput } from "./workbench-element-guards.js";
import { createWorkbenchPackages } from "./workbench-packages.js";

/**
 * @typedef {import("../dock/dock.js").DockStatusMetrics} DockStatusMetrics
 * @typedef {import("../dock/dock.js").DockStatusSnapshot} DockStatusSnapshot
 * @typedef {import("../packages/packages-recommended.js").PackageRef} PackageRef
 * @typedef {import("./layout-prefs.js").LayoutPrefs} LayoutPrefs
 *
 * @typedef {{
 *   id?: string,
 *   thinkingLevel?: string,
 *   provider?: string,
 *   baseUrl?: string,
 *   contextWindow?: number,
 *   thinkingBudgetField?: string,
 * }} WorkbenchModelInfo
 *
 * @typedef {{
 *   ok?: boolean,
 *   data?: {
 *     level?: string,
 *     budgets?: Record<string, number | undefined>,
 *     packages?: Array<{ name?: string, state?: string, error?: string }>,
 *   },
 * }} ConfigCallResult
 *
 * @typedef {(
 *   method: string,
 *   args?: Record<string, unknown>,
 *   options?: Record<string, unknown>,
 * ) => Promise<ConfigCallResult | null | undefined>} ConfigCall
 *
 * @typedef {{
 *   getModelInfo?: (() => WorkbenchModelInfo | null | undefined) | null,
 *   getWorkspaceId?: (() => string | null | undefined) | null,
 *   sendPrompt?: ((message: string) => unknown) | null,
 *   getPackages?: (() => PackageRef[]) | null,
 *   onOpenSettings?: ((page?: string) => unknown) | null,
 *   onOpenFile?: ((path: string, line?: number) => unknown) | null,
 *   onPanelShown?: ((id: string) => void) | null,
 *   onDockTabChange?: ((id: string) => void) | null,
 *   openInTerminal?: (() => unknown) | null,
 *   onRunFile?: ((path: string) => unknown) | null,
 *   onNavigateTree?: ((target: unknown) => unknown) | null,
 *   installPackage?: ((source: string) => unknown) | null,
 *   scrapeEngine?: ((args: { baseUrl: string, metricsUrl: string }) => Promise<unknown>) | null,
 *   onPinContext?: ((item: unknown) => unknown) | null,
 *   onDropContext?: ((item: unknown) => unknown) | null,
 *   configCall?: ConfigCall | null,
 *   loadHistoryCommands?: (() => Promise<Array<{ name?: string, sourceInfo?: { source?: string, path?: string } }>>) | null,
 *   loadShadowHistory?: (() => Promise<{
 *     empty?: boolean,
 *     hasHead?: boolean,
 *     meta?: { realpath?: string, cwd?: string } | null,
 *     files?: Array<{ path?: string, status?: string }>,
 *   } | null | undefined>) | null,
 *   chrome?: WorkbenchChrome,
 * }} CreateSpopiWorkbenchOptions
 *
 * @typedef {{
 *   layout: import("./shell-layout.js").ShellLayoutNodes,
 *   inputArea: HTMLElement | null,
 *   headerRight: HTMLElement | null,
 *   status: HTMLElement | null,
 *   terminal: HTMLElement | null,
 * }} WorkbenchChrome
 *
 * @typedef {{
 *   get?: (key: string) => Promise<unknown> | unknown,
 *   set?: (key: string, value: unknown) => Promise<unknown> | unknown,
 * }} WorkbenchPreferences
 *
 * @typedef {{
 *   t?: (key: string, params?: Record<string, unknown>) => string,
 *   persistLayout?: (layout: LayoutPrefs) => void | Promise<void>,
 *   onSettings?: () => void,
 *   onOpenAppearance?: () => void,
 *   onOpenExtensions?: () => void,
 *   onPanelShown?: ((id: string) => void) | null | undefined,
 *   layout?: import("./shell-layout.js").ShellLayoutNodes,
 * }} ApplyShellLayoutOptions
 *
 * @typedef {{
 *   layout: LayoutPrefs,
 *   paneCenter?: Element | null,
 *   applyHidden?: (flags: Partial<LayoutPrefs>) => void,
 *   applyLayout?: (layout: LayoutPrefs) => void,
 *   showCenter?: () => void,
 * }} ShellApi
 *
 * @typedef {{
 *   header?: HTMLElement | null,
 *   t?: (key: string) => string,
 *   onToggleDock?: (force?: boolean) => void,
 *   onToggleChat?: () => void,
 *   onOpenCockpit?: () => void,
 *   onOpenTerminal?: () => void,
 * }} HeaderChromeOptions
 */

/** @type {(options?: ApplyShellLayoutOptions) => ShellApi | null} */
const mountShellLayout = /** @type {(options?: ApplyShellLayoutOptions) => ShellApi | null} */ (
  applyShellLayout
);

/** @type {(options?: HeaderChromeOptions) => unknown} */
const mountHeader = /** @type {(options?: HeaderChromeOptions) => unknown} */ (mountHeaderChrome);

/** @type {(status?: DockStatusMetrics) => void} */
const paintMetrics = /** @type {(status?: DockStatusMetrics) => void} */ (paintHeaderMetrics);

/**
 * @param {object} [options]
 * @param {CreateSpopiWorkbenchOptions["getModelInfo"]} [options.getModelInfo]
 * @param {CreateSpopiWorkbenchOptions["getWorkspaceId"]} [options.getWorkspaceId]
 * @param {CreateSpopiWorkbenchOptions["sendPrompt"]} [options.sendPrompt]
 * @param {CreateSpopiWorkbenchOptions["getPackages"]} [options.getPackages]
 * @param {CreateSpopiWorkbenchOptions["onOpenSettings"]} [options.onOpenSettings]
 * @param {CreateSpopiWorkbenchOptions["onOpenFile"]} [options.onOpenFile]
 * @param {CreateSpopiWorkbenchOptions["onPanelShown"]} [options.onPanelShown]
 * @param {CreateSpopiWorkbenchOptions["onDockTabChange"]} [options.onDockTabChange]
 * @param {CreateSpopiWorkbenchOptions["openInTerminal"]} [options.openInTerminal]
 * @param {CreateSpopiWorkbenchOptions["onRunFile"]} [options.onRunFile]
 * @param {CreateSpopiWorkbenchOptions["onNavigateTree"]} [options.onNavigateTree]
 * @param {CreateSpopiWorkbenchOptions["installPackage"]} [options.installPackage]
 * @param {CreateSpopiWorkbenchOptions["scrapeEngine"]} [options.scrapeEngine]
 * @param {CreateSpopiWorkbenchOptions["onPinContext"]} [options.onPinContext]
 * @param {CreateSpopiWorkbenchOptions["onDropContext"]} [options.onDropContext]
 * @param {CreateSpopiWorkbenchOptions["configCall"]} [options.configCall]
 * @param {CreateSpopiWorkbenchOptions["loadHistoryCommands"]} [options.loadHistoryCommands]
 * @param {CreateSpopiWorkbenchOptions["loadShadowHistory"]} [options.loadShadowHistory]
 * @param {CreateSpopiWorkbenchOptions["chrome"]} [options.chrome]
 */
export function createSpopiWorkbench({
  getModelInfo,
  getWorkspaceId,
  sendPrompt,
  getPackages,
  onOpenSettings,
  onOpenFile,
  onPanelShown,
  onDockTabChange,
  openInTerminal,
  onRunFile,
  onNavigateTree,
  installPackage,
  scrapeEngine,
  onPinContext,
  onDropContext,
  configCall,
  chrome,
} = {}) {
  /** @returns {PackageRef[]} */
  const packages = () => (typeof getPackages === "function" ? getPackages() : []);
  /** @type {(layout: LayoutPrefs) => void | Promise<void>} */
  let persistLayout = async () => {};
  /** @type {() => void | Promise<void>} */
  let persistFirstRun = async () => {};
  const shell = mountShellLayout({
    t,
    persistLayout: (layout) => persistLayout(normalizeLayout(layout)),
    onSettings: () => {
      if (onOpenSettings) onOpenSettings();
      else asClickable(sidebarChromeRefs().settingsBtn)?.click();
    },
    onOpenAppearance: () => {
      if (onOpenSettings) onOpenSettings("appearance");
      else asClickable(sidebarChromeRefs().settingsBtn)?.click();
    },
    onOpenExtensions: () => {
      if (onOpenSettings) onOpenSettings("extensions");
      else asClickable(sidebarChromeRefs().settingsBtn)?.click();
    },
    onPanelShown: onPanelShown || undefined,
    layout: chrome?.layout,
  });
  const dock = createDockHost(shell?.paneCenter, {
    t,
    onTabChange: onDockTabChange || undefined,
    terminal: chrome?.terminal,
  });
  const host = dock?.panels || {};
  /** @type {() => void} */
  let paintProblemsEmpty = () => {};
  const problems = mountProblemsDock(host.problems, {
    t,
    onOpenFile: (path, line) => onOpenFile?.(path, line),
    onChange: () => paintProblemsEmpty(),
  });
  paintProblemsEmpty = () => {
    const root = host.problems;
    if (!root) return;
    root.querySelector(".dock-empty")?.remove();
    if (root.querySelector(".problem-row")) return;
    const empty = document.createElement("p");
    empty.className = "dock-empty";
    const affordance = createAffordances("problems", packages());
    empty.textContent = affordance?.why ? t(affordance.why) : t("dock.noProblems");
    root.appendChild(empty);
  };
  registerProblemsLanguageStatus((text) => {
    problems?.setLanguageStatus(text);
  });
  paintProblemsEmpty();
  const metricsOverlay = new MetricsOverlay({
    getModelInfo,
    container: host.cockpit || document.body,
    scrapeFn: scrapeEngine
      ? async ({ baseUrl, metricsUrl }) =>
          /** @type {import("../metrics/metrics-overlay.js").MetricsScrapeResult | null | undefined} */ (
            await scrapeEngine({ baseUrl, metricsUrl })
          )
      : null,
    onThinkingBudget: (tokens, info) => {
      void configCall?.("set_thinking_budget", {
        level: info.level || getModelInfo?.()?.thinkingLevel || "high",
        tokens,
      });
    },
    onSnapshot: (snapshot) => {
      const status = dockStatusFromSnapshot(
        /** @type {DockStatusSnapshot} */ (/** @type {unknown} */ (snapshot)),
      );
      renderDockStatus(dockStatusElement(), status);
      paintMetrics(status);
    },
  });
  connectCacheWarming(configCall);

  const files = fileSidebarRefs();
  mountFileSearch({
    input: /** @type {HTMLInputElement | null} */ (files.searchInput),
    clearButton: /** @type {HTMLElement | null} */ (files.searchClear),
    results: /** @type {HTMLElement | null} */ (files.searchResults),
    tree: /** @type {HTMLElement | null} */ (files.fileList),
    pathEl: /** @type {HTMLElement | null} */ (files.path),
    t,
    search: (opts) => searchWorkspace({ ...opts, workspaceId: getWorkspaceId?.() || undefined }),
    onOpenFile: onOpenFile || undefined,
  });
  const extensions = createWorkbenchPackages({
    packages,
    installPackage,
    configCall,
    onDismissFirstRun: () => persistFirstRun(),
  });
  const { refreshPackageHealth } = extensions;
  function refreshHistory() {}
  extensions.remount();
  refreshPackageHealth();
  const composerRefs = composerChromeRefs();
  const chips = mountWorkbenchComposer({
    composerRefs,
    workspacePathEl: files.path,
    onOpenFile,
  });
  const live = mountLiveStrip(chrome?.inputArea ?? null, {
    t,
    onSteer: () => {
      const input = asSteerInput(composerRefs.messageInput);
      if (input) {
        input.placeholder = t("chat.steerPlaceholder") || "Steer the running turn...";
        input.focus();
      }
    },
    onStop: () => asClickable(composerRefs.abortBtn)?.click(),
  });

  const openCockpit = () => {
    closeReview();
    dock?.setTab?.("cockpit");
    shell?.applyHidden?.({ dockHidden: false });
  };
  registerSpopiCommands({ dock, shell });
  const status = asStatusButton(chrome?.status);
  if (status) {
    status.classList.add("status-cockpit");
    status.tabIndex = 0;
    status.setAttribute("role", "button");
    status.title = t("dock.status") || "Session and server metrics";
    status.addEventListener("click", openCockpit);
    status.addEventListener("keydown", (event) => {
      if (!("key" in event)) return;
      const key = String(event.key);
      if (key !== "Enter" && key !== " ") return;
      event.preventDefault();
      openCockpit();
    });
  }

  mountHeader({
    header: chrome?.headerRight ?? null,
    t,
    onToggleDock: (force) =>
      shell?.applyHidden?.({
        dockHidden: typeof force === "boolean" ? force : !shell.layout.dockHidden,
      }),
    onToggleChat: () => shell?.applyHidden?.({ chatHidden: !shell.layout.chatHidden }),
    onOpenCockpit: openCockpit,
    onOpenTerminal: () => openInTerminal?.(),
  });

  // Contract: tree clicks call navigateActiveTree (get_tree / navigate_tree), not /undo.
  const center = mountCenterTabs(shell?.paneCenter, {
    t,
    sendPrompt: sendPrompt || undefined,
    onNavigate: onNavigateTree || undefined,
  });
  const context = mountContextInspector(center?.context, {
    t,
    onCompact: () => sendPrompt?.("/compact"),
    onPin: onPinContext || undefined,
    onDrop: onDropContext || undefined,
  });
  mountHomePane(shell?.paneCenter);
  const preview = filePreviewRefs();
  mountRunFileButton({
    button: /** @type {import("../terminal/run-file.js").RunFileButtonLike | null} */ (preview.run),
    run: (path) => onRunFile?.(path),
    t,
  });

  async function loadThinkingBudgets() {
    if (!configCall) return;
    try {
      const result = await configCall("get_thinking_budgets");
      if (!result?.ok) return;
      const info = getModelInfo?.() || {};
      const level = info.thinkingLevel || result.data?.level || "high";
      const tokens = result.data?.budgets?.[level] ?? result.data?.budgets?.high;
      if (tokens != null) metricsOverlay.setThinkingBudget(tokens);
    } catch {
      // Settings are optional until the config gateway is ready.
    }
  }

  connectEditorSelection({ composerRefs, chips, previewPanel: preview.panel, configCall });

  return {
    metricsOverlay,
    shell,
    dock,
    center,
    live,
    /**
     * @param {WorkbenchPreferences | null | undefined} preferences
     */
    attachPreferences(preferences) {
      persistLayout = (layout) => {
        void (
          /** @type {{ catch?: (fn: () => void) => unknown } | undefined} */ (
            preferences?.set?.("ui.layout", normalizeLayout(layout))
          )?.catch?.(() => {})
        );
      };
      persistFirstRun = () => {
        extensions.markFirstRunDismissed();
        void (
          /** @type {{ catch?: (fn: () => void) => unknown } | undefined} */ (
            preferences?.set?.(FIRST_RUN_KEY, true)
          )?.catch?.(() => {})
        );
        extensions.remount();
      };
      void (
        /** @type {Promise<unknown> | undefined} */ (preferences?.get?.("ui.layout"))
          ?.then((value) => {
            if (value && typeof value === "object") {
              const layout = normalizeLayout(/** @type {Partial<LayoutPrefs>} */ (value));
              applyLayoutVars(layout);
              shell?.applyLayout?.(layout);
            }
          })
          .catch(() => {})
      );
      void (
        /** @type {Promise<unknown> | undefined} */ (preferences?.get?.(FIRST_RUN_KEY))
          ?.then((value) => {
            if (value) {
              extensions.markFirstRunDismissed();
              extensions.remount();
            }
          })
          .catch(() => {})
      );
      void loadThinkingBudgets();
    },
    loadThinkingBudgets,
    /**
     * @param {import("../chat/context-inspector-model.js").ContextMessage[]} [messages]
     */
    setContextMessages(messages = []) {
      context?.setMessages?.(messages);
    },
    setChangedFiles() {},
    refreshPackages() {
      extensions.remount();
      paintProblemsEmpty();
      void refreshHistory();
    },
    refreshPackageHealth,
    refreshHistory,
    /**
     * @param {unknown} name
     * @param {unknown} result
     */
    noteLensResult(name, result) {
      problems?.noteResult(name, result);
    },
    /**
     * @param {HTMLElement | null | undefined} messageEl
     * @param {Parameters<typeof appendAssistantTurnMeta>[1]} snapshot
     */
    noteTurnMeta(messageEl, snapshot) {
      appendAssistantTurnMeta(messageEl, snapshot);
    },
    /**
     * @param {HTMLElement | null | undefined} messageEl
     * @param {(command?: string) => void} [onAction]
     */
    noteUserTurnActions(messageEl, onAction) {
      appendUserTurnActions(messageEl, onAction);
    },
    /**
     * @param {DockStatusMetrics | DockStatusSnapshot | null | undefined} snapshot
     */
    updateDockStatus(snapshot) {
      const status =
        snapshot &&
        typeof snapshot === "object" &&
        "tokPerSec" in snapshot &&
        snapshot.tokPerSec != null
          ? /** @type {DockStatusMetrics} */ (snapshot)
          : dockStatusFromSnapshot(/** @type {DockStatusSnapshot} */ (snapshot || {}));
      renderDockStatus(dockStatusElement(), status);
      paintMetrics(status);
    },
    turnMeta: { assistantTurnMeta, userTurnActions },
    /**
     * @param {unknown} query
     */
    async search(query) {
      return searchWorkspace({ query, workspaceId: getWorkspaceId?.() || undefined });
    },
  };
}
