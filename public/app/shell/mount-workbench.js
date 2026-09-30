// ABOUTME: SPOPI workbench composition: shell, dock, center tabs, packages, live chat chrome.
// ABOUTME: Empty callbacks are not left here — each mount gets a real host contract.

import {
  appendMentionToComposer,
  appendSelectionToComposer,
  mountContextChips,
} from "../chat/context-chips.js";
import { mountContextInspector } from "../chat/context-inspector-tab.js";
import { mountLiveStrip } from "../chat/live-strip.js";
import {
  appendAssistantTurnMeta,
  appendUserTurnActions,
  assistantTurnMeta,
  userTurnActions,
} from "../chat/turn-meta.js";
import { setComposerInsert, setInlineEdit } from "../composer/composer-actions.js";
import { mountMentionChips } from "../composer/mention-chips.js";
import {
  createDockHost,
  dockStatusElement,
  dockStatusFromSnapshot,
  renderDockStatus,
} from "../dock/dock.js";
import { mountProblemsDock } from "../dock/problems-dock.js";
import { mountCenterTabs } from "../editor/center-tabs.js";
import {
  formatContextChip,
  formatSelectionMention,
  formatSelectionPrompt,
} from "../editor/editor-context.js";
import { mountHomePane } from "../editor/home-pane.js";
import { openInlineEdit } from "../editor/inline-edit-host.js";
import { mountFileSearch } from "../files/file-search.js";
import { searchWorkspace } from "../files/search-model.js";
import { t } from "../i18n/i18n.js";
import { bindCacheWarming } from "../metrics/cache-warming-control.js";
import { MetricsOverlay } from "../metrics/metrics-overlay.js";
import { extensionErrors } from "../packages/extension-errors.js";
import { notePackageHealth } from "../packages/packages-installed.js";
import { mountExtensionsPanel } from "../packages/packages-page.js";
import { createAffordances, FIRST_RUN_KEY } from "../packages/packages-recommended.js";
import { extensionsSettingsRefs } from "../settings/extensions-settings.js";
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
 *   getSessionPath?: (() => string | null | undefined) | null,
 *   sendPrompt?: ((message: string) => unknown) | null,
 *   getPackages?: (() => PackageRef[]) | null,
 *   onOpenSettings?: ((page?: string) => unknown) | null,
 *   onOpenFile?: ((path: string, line?: number) => unknown) | null,
 *   onPanelShown?: ((id: string) => void) | null,
 *   onDockTabChange?: ((id: string) => void) | null,
 *   openInTerminal?: ((path: string) => unknown) | null,
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
 * }} CreateSpopiWorkbenchOptions
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
 * }} ApplyShellLayoutOptions
 *
 * @typedef {{
 *   layout: LayoutPrefs,
 *   paneCenter?: Element | null,
 *   applyHidden?: (flags: Partial<LayoutPrefs>) => void,
 *   applyLayout?: (layout: LayoutPrefs) => void,
 * }} ShellApi
 *
 * @typedef {{
 *   t?: (key: string) => string,
 *   onToggleDock?: (force?: boolean) => void,
 *   onToggleChat?: () => void,
 *   onOpenCockpit?: () => void,
 *   onOpenTerminal?: () => void,
 * }} HeaderChromeOptions
 *
 * @typedef {{
 *   click: () => void,
 * }} ClickableEl
 *
 * @typedef {{
 *   focus: () => void,
 *   placeholder: string,
 * }} SteerInputEl
 *
 * @typedef {{
 *   value: string,
 *   focus: () => void,
 *   selectionStart?: number | null,
 *   selectionEnd?: number | null,
 * }} TextInputEl
 *
 * @typedef {{
 *   title: string,
 * }} TitledEl
 *
 * @typedef {{
 *   tabIndex: number,
 *   title: string,
 *   classList: DOMTokenList,
 *   setAttribute: (name: string, value: string) => void,
 *   addEventListener: (
 *     type: string,
 *     listener: (event: Event) => void,
 *   ) => void,
 * }} StatusButtonEl
 *
 * @typedef {{
 *   path?: string,
 *   startLine?: number,
 *   endLine?: number,
 *   text?: string,
 *   kind?: string,
 *   truncated?: boolean,
 *   instruction?: string,
 *   apply?: (replacement: string) => boolean,
 * }} SelectionDetail
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
 * @param {Element | null | undefined} el
 * @returns {ClickableEl | null}
 */
function asClickable(el) {
  if (!el || typeof el !== "object") return null;
  if (!("click" in el) || typeof el.click !== "function") return null;
  return /** @type {ClickableEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {SteerInputEl | null}
 */
function asSteerInput(el) {
  if (!el || typeof el !== "object") return null;
  if (!("focus" in el) || typeof el.focus !== "function") return null;
  if (!("placeholder" in el)) return null;
  return /** @type {SteerInputEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {TextInputEl | null}
 */
function asTextInput(el) {
  if (!el || typeof el !== "object") return null;
  if (!("value" in el) || !("focus" in el)) return null;
  return /** @type {TextInputEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {TitledEl | null}
 */
function asTitled(el) {
  if (!el || typeof el !== "object") return null;
  if (!("title" in el)) return null;
  return /** @type {TitledEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {StatusButtonEl | null}
 */
function asStatusButton(el) {
  if (!el || typeof el !== "object") return null;
  if (!("tabIndex" in el) || !("title" in el) || !("classList" in el)) return null;
  if (!("setAttribute" in el) || !("addEventListener" in el)) return null;
  return /** @type {StatusButtonEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
function asHtmlHost(el) {
  if (!el || typeof el !== "object") return null;
  if (!("appendChild" in el) || !("classList" in el)) return null;
  return /** @type {HTMLElement} */ (el);
}

/**
 * @param {object} [options]
 * @param {CreateSpopiWorkbenchOptions["getModelInfo"]} [options.getModelInfo]
 * @param {CreateSpopiWorkbenchOptions["getWorkspaceId"]} [options.getWorkspaceId]
 * @param {CreateSpopiWorkbenchOptions["getSessionPath"]} [options.getSessionPath]
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
 */
export function createSpopiWorkbench({
  getModelInfo,
  getWorkspaceId,
  getSessionPath,
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
} = {}) {
  /** @returns {PackageRef[]} */
  const packages = () => (typeof getPackages === "function" ? getPackages() : []);
  /** @type {(layout: LayoutPrefs) => void | Promise<void>} */
  let persistLayout = async () => {};
  /** @type {() => void | Promise<void>} */
  let persistFirstRun = async () => {};
  let firstRunDismissed = false;
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
  });
  const dock = createDockHost(shell?.paneCenter, { t, onTabChange: onDockTabChange || undefined });
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
  bindCacheWarming(configCall);

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
  /** @type {Array<{ name?: string, state?: string, error?: string }>} */
  let lastHealth = [];
  /** @type {Set<string>} */
  const installingSources = new Set();
  /** @type {Map<string, string>} */
  const installErrors = new Map();
  /** @type {{ done: number, total: number } | null} */
  let installProgress = null;
  let installFlight = false;
  /**
   * @param {string[]} sources
   */
  async function installSources(sources) {
    if (installFlight || !sources.length) return;
    installFlight = true;
    installProgress = { done: 0, total: sources.length };
    try {
      for (const source of sources) {
        installingSources.add(source);
        installErrors.delete(source);
        remountExtensions();
        try {
          if (!installPackage) throw new Error(t("extensions.desktopOnly"));
          await installPackage(source);
        } catch (error) {
          const message =
            error && typeof error === "object" && "message" in error && error.message != null
              ? String(error.message)
              : String(error || t("extensions.installFailed"));
          installErrors.set(source, message);
        } finally {
          installingSources.delete(source);
          installProgress = {
            done: (installProgress?.done || 0) + 1,
            total: sources.length,
          };
          remountExtensions();
        }
      }
    } finally {
      installFlight = false;
      installProgress = null;
      remountExtensions();
    }
  }
  const remountExtensions = (
    /** @type {Array<{ name?: string, state?: string, error?: string }> | undefined} */ health = undefined,
  ) => {
    if (health) lastHealth = health;
    return mountExtensionsPanel(extensionsSettingsRefs(document).recommendedHost, {
      t,
      packages: packages(),
      health: lastHealth,
      firstRunDismissed,
      installing: [...installingSources],
      installErrors: Object.fromEntries(installErrors),
      progress: installProgress,
      // Contract: install goes through installPiPackage. Never /install via chat.
      onInstall: (source) => installSources([source]),
      onInstallAll: (sources) => installSources(sources),
      onDismissFirstRun: () => persistFirstRun(),
    });
  };
  /**
   * @param {{ workspaceId?: string, sessionId?: string, instanceId?: string } | null | undefined} [target]
   */
  function refreshPackageHealth(target) {
    void configCall?.("package_health", { packages: packages(), errors: extensionErrors(target) })
      ?.then((result) => {
        const rows = result?.data?.packages || [];
        notePackageHealth(rows);
        remountExtensions(rows);
      })
      ?.catch(() => {});
  }
  function refreshHistory() {}
  remountExtensions();
  refreshPackageHealth();
  const composerRefs = composerChromeRefs();
  const composer = asHtmlHost(composerRefs.card);
  const chips = mountContextChips(composer);
  const mentionInput = asTextInput(composerRefs.messageInput);
  if (mentionInput && composer) {
    mountMentionChips({
      input: /** @type {HTMLInputElement | HTMLTextAreaElement} */ (mentionInput),
      host: composer,
      resolveAbsolute: (path) => {
        const pathEl = asTitled(files.path);
        const root = pathEl?.title || "";
        return [root.replace(/[\\/]+$/, ""), path].filter(Boolean).join("/");
      },
      onOpen: (path) => onOpenFile?.(path),
    });
  }
  const inputArea = asHtmlHost(document.querySelector(".input-area"));
  const live = mountLiveStrip(inputArea, {
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
    dock?.setTab?.("cockpit");
    shell?.applyHidden?.({ dockHidden: false });
  };
  registerSpopiCommands({ dock, shell });
  const status = asStatusButton(document.querySelector(".header .status"));
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
    t,
    onToggleDock: (force) =>
      shell?.applyHidden?.({
        dockHidden: typeof force === "boolean" ? force : !shell.layout.dockHidden,
      }),
    onToggleChat: () => shell?.applyHidden?.({ chatHidden: !shell.layout.chatHidden }),
    onOpenCockpit: openCockpit,
    onOpenTerminal: () => openInTerminal?.(getSessionPath?.() || ""),
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

  setInlineEdit((detail) => {
    openInlineEdit(/** @type {SelectionDetail} */ (detail), {
      previewParent: preview.panel,
      modelCall: configCall
        ? async (method, args) =>
            /** @type {{ data?: { text?: string }, text?: string } | null | undefined} */ (
              await configCall(method, args)
            )
        : undefined,
    });
  });
  setComposerInsert((detail) => {
    const input = asTextInput(composerRefs.messageInput);
    const selection = /** @type {SelectionDetail} */ ({ ...detail, instruction: "" });
    if (!selection.kind && selection.path && selection.startLine) {
      // An editor selection is a file on disk: a linked @file:lines pill, not a pasted copy.
      appendMentionToComposer(
        /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (input),
        formatSelectionMention(selection),
      );
      input?.focus();
      return;
    }
    const formatted = formatSelectionPrompt(selection).replace(/^\n+/, "");
    appendSelectionToComposer(
      /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (input),
      formatted,
    );
    chips?.add({
      id: `${selection.path}:${selection.startLine}`,
      label: formatContextChip(selection),
    });
    input?.focus();
  });

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
        firstRunDismissed = true;
        void (
          /** @type {{ catch?: (fn: () => void) => unknown } | undefined} */ (
            preferences?.set?.(FIRST_RUN_KEY, true)
          )?.catch?.(() => {})
        );
        remountExtensions();
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
              firstRunDismissed = true;
              remountExtensions();
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
      remountExtensions();
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
