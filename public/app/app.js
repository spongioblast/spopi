// ABOUTME: Native session composition root: Pi RPC, workbench, preview, git, and chat.
// ABOUTME: SPOPI contracts (packages, PTY, scrape, tree) bind here; Pi stays the only harness.

import { createCompactCoordinator } from "./chat/compact-coordinator.js";
import { compactPreserveInstructions, dropContext, pinContext } from "./chat/context-pins.js";
import { mountHistory } from "./chat/mount-history.js";
import {
  isRpivTodoCommandNotify,
  isRpivTodoWidgetRequest,
  RpivTodoMirrorPanel,
} from "./chat/rpiv-todo-mirror.js";
import { createDeferredRuntimeHandler, createRuntimeEventHandler } from "./chat/runtime-events.js";
import { cancelQueuedMessage, stopRun } from "./chat/stop-run.js";
import { mountReviewCard, paintExtensionNotice } from "./chat/turn-block.js";
import { mergeTurnFiles } from "./chat/turn-files.js";
import { createUndoMarker, historyNotice } from "./chat/undo-marker.js";
import { mountChatFileActions } from "./chat/wire-chat-file-actions.js";
import { showApprovalOrDialog as showNativeDialog } from "./composer/approval-bar.js";
import { mountComposerAutoResize } from "./composer/composer-autoresize.js";
import { mountComposerImageAttachments } from "./composer/composer-images.js";
import { mountComposerPasteOffload } from "./composer/composer-paste-offload.js";
import { createComposerPiSync } from "./composer/composer-pi-sync.js";
import { mountComposerSlashMenu } from "./composer/composer-slash-menu.js";
import { mountGuardChip } from "./composer/guard-chip.js";
import { createModelConfigRefresh } from "./composer/model-config-refresh.js";
import { mountModelControls } from "./composer/model-controls.js";
import { mountComposer } from "./composer/mount-composer.js";
import { renderQueuedMessages } from "./composer/queued-messages.js";
import { createSendModelGate } from "./composer/send-model-gate.js";
import { buildCommandCatalog } from "./composer/slash-commands.js";
import { createFilePreviewFollow } from "./editor/file-preview-follow.js";
import { mountFilePreview } from "./editor/mount-file-preview.js";
import { createReviewSources } from "./editor/review/review-sources.js";
import { setReviewCommands, setReviewSend, setReviewSources } from "./editor/review-pane.js";
import { CustomUiPanel } from "./extension-ui/custom-ui-panel.js";
import { ExtensionCommandCompatibility } from "./extension-ui/extension-command-compatibility.js";
import { ExtensionUiHost } from "./extension-ui/extension-ui-host.js";
import { ExtensionWidgets } from "./extension-ui/extension-widgets.js";
import { showInlineExtensionPrompt } from "./extension-ui/inline-extension-prompt.js";
import {
  connectFileTree,
  mountSidebarToggle as setupFileSidebarToggle,
} from "./files/mount-file-browser.js";
import { mountGitPanel } from "./git/git-panel-integration.js";
import { createI18n, hydrateLanguagePreference, onLocaleChange, t } from "./i18n/i18n.js";
import { createNotificationCenter } from "./notifications/notification-center.js";
import {
  createNativeTaskNotificationSender,
  createTaskCompletionNotifications,
} from "./notifications/task-completion-notifications.js";
import { extractRuntimeEventError } from "./session/assistant-error.js";
import { createAssistantMessageStream } from "./session/assistant-message-stream.js";
import { mountContextUsage } from "./session/context-usage.js";
import { mountInfoSidebar } from "./session/info-sidebar.js";
import { mountMessageForkHandler } from "./session/message-fork.js";
import { describeHostError } from "./session/missing-workspace.js";
import { mountSessionSidebar } from "./session/mount-session-sidebar.js";
import { showProjectsFolderFallback } from "./session/projects-folder-fallback.js";
import { onSessionCreated } from "./session/session-created-action.js";
import { activeSession, mountSessionInfo } from "./session/session-info.js";
import { textFromMessageContent } from "./session/session-log.js";
import { createSessionSelectionHandler } from "./session/session-navigation.js";
import { createSessionRuntime } from "./session/session-runtime.js";
import { mountSessionSearchDialog } from "./session/session-search-dialog.js";
import { SessionSidebar } from "./session/session-sidebar.js";
import { createSessionStatus } from "./session/session-status.js";
import { createSessionStore, reduceSessionState } from "./session/session-store.js";
import { SessionUiStateStore } from "./session/session-ui-state.js";
import {
  createSessionViaHost,
  mountNewSessionButton,
  mountOpenFolderButton,
  openSessionInProjectViaHost,
  spawnSessionViaHost,
} from "./session/workspace-actions.js";
import { mountSettingsPanel } from "./settings/settings-panel.js";
import { mountAppChrome } from "./shell/app-chrome.js";
import { mountAppUpdater } from "./shell/app-updater.js";
import { toggleExclusiveSideView } from "./shell/exclusive-side-panel.js";
import { isFilePanelShortcut, isMacOS } from "./shell/file-panel-shortcut.js";
import { maybeShowFirstRun } from "./shell/first-run.js";
import { mountHeaderOpenApp } from "./shell/header-open-app.js";
import { createSpopiWorkbench } from "./shell/mount-workbench.js";
import { mountOverlayChrome } from "./shell/overlay-chrome.js";
import { mountProjectHeader } from "./shell/project-header.js";
import { mountSessionCostBar } from "./shell/session-cost-bar.js";
import { mountUiReload } from "./shell/ui-reload.js";
import { createUiStoreBinding, hydrateUiStore } from "./storage/ui-store.js";
import {
  INSPECT_WIDGET,
  isSubagentWidget,
  parseInspect,
  parseRuns,
  stopCommand,
} from "./subagents/subagent-feed.js";
import { SubagentStrip } from "./subagents/subagent-strip.js";
import {
  applySubagentInspect,
  configureSubagentView,
  noteSubagentRuns,
  openSubagent,
  resetSubagentView,
} from "./subagents/subagent-view.js";
import { openSessionInPtyTwin, resolveResumePath } from "./terminal/open-in-terminal.js";
import { mountTerminalPanel } from "./terminal/terminal-panel-integration.js";
import { applyTheme, getCurrentTheme, hydrateThemePreference } from "./theme/themes.js";
import { ConfigGateway, consumeConfigResponseFrame } from "./transport/config-gateway.js";
import {
  createConfigGatewayConnectionListener,
  signalConfigGatewayReady,
} from "./transport/config-gateway-readiness.js";
import { HostControlGateway } from "./transport/control-gateway.js";
import { HostDataGateway } from "./transport/data-gateway.js";
import { createOauthGateway } from "./transport/oauth-gateway.js";
import { PreferenceGateway } from "./transport/preference-gateway.js";
import { HostRuntimeAdapter, resolveHostWebSocketUrl } from "./transport/runtime-adapter.js";
import { routeRuntimeFrame } from "./transport/runtime-frame-routing.js";
import { RuntimeGateway } from "./transport/runtime-gateway.js";
import { readFile } from "./transport/workspace-http.js";
import { buildAtMentionValue, mountAtFileMention } from "./ui/at-file-mention.js";
import { ConvNav } from "./ui/conv-nav.js";
import { mountMessagesInsets } from "./ui/layout-insets.js";
import { MessageRenderer } from "./ui/message-renderer.js";
import { mountResizablePanel, refreshResizablePanels } from "./ui/resizable-panel.js";
import { ToolCardRenderer } from "./ui/tool-card.js";
import { mountAppKeyboardShortcuts } from "./utils/keyboard-shortcuts.js";
import { randomId, sessionScopedClientId } from "./utils/random-id.js";
import { parseAppRoute, replaceTemporarySessionRoute } from "./utils/router.js";

/**
 * Session-route chrome refs (mountAppChrome succeeds whenever `.app-layout` is empty).
 * Element fields are typed for call sites that expect HTMLElement / form controls.
 *
 * @typedef {{
 *   sidebar: {
 *     sidebar: HTMLElement,
 *     overlay: HTMLElement,
 *     newSessionBtn: HTMLElement | null,
 *     openFolderBtn: HTMLElement | null,
 *     refreshSessionsBtn: HTMLElement | null,
 *     sessionList: HTMLElement | null,
 *     settingsBtn: HTMLElement | null,
 *     extensionsBtn: HTMLElement | null,
 *     skillsBtn: HTMLElement | null,
 *   },
 *   chat: {
 *     header: HTMLElement,
 *     messages: HTMLElement | null,
 *     scrollBottomBadge: HTMLElement | null,
 *     sidebarToggle: HTMLElement | null,
 *     sessionInfoToggle: HTMLElement | null,
 *     sessionInfoPanel: HTMLElement | null,
 *     sessionInfoFile: HTMLElement | null,
 *     sessionInfoId: HTMLElement | null,
 *     statusIndicator: HTMLElement | null,
 *     statusText: HTMLElement | null,
 *     sessionCost: HTMLElement | null,
 *     compactContextBtn: HTMLElement | null,
 *     infoSidebarToggle: HTMLElement | null,
 *     diffSidebarToggle: HTMLElement | null,
 *     packageUpdateIndicator: HTMLElement | null,
 *     fileSidebarToggle: HTMLElement | null,
 *   },
 *   composer: {
 *     inputArea: HTMLElement,
 *     form: HTMLFormElement | null,
 *     composerCard: HTMLElement | null,
 *     messageInput: HTMLTextAreaElement | null,
 *     sendBtn: HTMLButtonElement | null,
 *     abortBtn: HTMLButtonElement | null,
 *     thinkingBtn: HTMLButtonElement | null,
 *     queuedMessages: HTMLElement | null,
 *     widgetsAbove: HTMLElement | null,
 *     widgetsBelow: HTMLElement | null,
 *     skillSlashMenu: HTMLElement | null,
 *     atFileMentionMenu: HTMLElement | null,
 *     imagePreviews: HTMLElement | null,
 *     imageInput: HTMLInputElement | null,
 *     attachBtn: HTMLButtonElement | null,
 *     commandBtn: HTMLButtonElement | null,
 *     modelDropdown: HTMLElement | null,
 *     modelDropdownBtn: HTMLButtonElement | null,
 *     modelDropdownLabel: HTMLElement | null,
 *     modelDropdownMenu: HTMLElement | null,
 *   },
 *   filePreview: {
 *     resizer: HTMLElement | null,
 *     panel: HTMLElement | null,
 *     tabs: HTMLElement | null,
 *     content: HTMLElement | null,
 *     controls: import("./editor/file-preview-panel.js").FilePreviewControls,
 *   },
 *   fileSidebar: {
 *     sidebar: HTMLElement,
 *     fileList: HTMLElement | null,
 *     gitPanel: HTMLElement | null,
 *     path: HTMLElement | null,
 *     up: HTMLButtonElement | null,
 *     refresh: HTMLButtonElement | null,
 *     toggleHidden: HTMLButtonElement | null,
 *     collapse: HTMLButtonElement | null,
 *     finder: HTMLButtonElement | null,
 *     close: HTMLButtonElement | null,
 *   },
 *   sidePanels: {
 *     info: HTMLElement | null,
 *     infoPanel: HTMLElement | null,
 *     infoRefresh: HTMLElement | null,
 *     infoClose: HTMLElement | null,
 *   },
 * }} AppChromeRefs
 *
 * @typedef {{ core?: { invoke?: unknown } }} TauriGlobal
 * @typedef {{
 *   id?: string,
 *   workspaceId?: string,
 *   name?: string,
 *   firstMessage?: string | null,
 *   filePath?: string,
 *   timestamp?: string,
 *   modifiedAtMs?: number,
 *   isCurrentWorkspace?: boolean,
 * }} AppSidebarSession
 * @typedef {{
 *   sessions?: AppSidebarSession[],
 *   load?: (opts?: { quiet?: boolean }) => Promise<unknown>,
 *   upsertSession?: (session: AppSidebarSession) => void,
 *   setStreaming?: (sessionId: string | undefined, streaming: boolean) => void,
 *   reloadUiPrefs?: () => void,
 * }} AppSidebar
 * @typedef {{
 *   provider?: string | null,
 *   id?: string,
 *   modelId?: string | null,
 *   thinkingLevel?: string,
 *   contextWindow?: number,
 *   baseUrl?: string,
 *   available?: Array<{ provider?: string, id?: string, baseUrl?: string, compat?: { thinkingTokenBudgetField?: string } }>,
 *   availableLoaded?: boolean,
 *   scopedIds?: string[],
 *   scopedLoaded?: boolean,
 * }} AppComposerModel
 * @typedef {{
 *   configCall?: (op: string, params?: unknown, options?: unknown) => unknown,
 *   openFile?: (path: string, line?: number) => unknown,
 *   navigateTree?: (entryId: string) => unknown,
 *   onPanelShown?: (id: string) => void,
 *   openInTerminal?: (sessionPath: string) => unknown,
 *   openSettings?: (tab?: string) => void,
 *   runFile?: (path: string) => unknown,
 *   continueLiveTurnBelow?: (anchor: Element) => void,
 * }} AppLateBindings
 * @typedef {{ spopi?: Record<string, unknown> }} SpopiWindow
 */

// Declared before the first `await` in this module: `hydrateSnapshotOnce()`
// is called both from the runtime-event subscriber and from the startup
// try-block, either of which can run while the module is paused at a later
// `await`. Declaring this variable after those awaits would leave it in the
// TDZ and cause "Cannot access 'snapshotInFlight' before initialization" when
// the handler fires before module evaluation reaches the `let` line.
let snapshotInFlight = false;
// Status lives in its own module so hooks can fire while this file is paused
// on a later `await` without hitting TDZ on `let statusKind`.
const sessionStatus = createSessionStatus({ t });
const { renderStatus, setStatus } = sessionStatus;
const route = parseAppRoute(window.location.pathname);
if (route.name !== "session") throw new Error("Native SPOPI requires a session route");
applyTheme(getCurrentTheme());
await createI18n();
const chrome = /** @type {AppChromeRefs} */ (
  mountAppChrome(document.querySelector(".app-layout")).refs
);
mountOverlayChrome(document.body);
const messagesElement = chrome.chat.messages;
const headerElement = chrome.chat.header;
const scrollBottomBadge = chrome.chat.scrollBottomBadge;
const convNav = new ConvNav({
  messagesEl: /** @type {HTMLElement} */ (messagesElement),
  headerEl: headerElement,
  badgeEl: scrollBottomBadge,
  // Jumping the chat to a turn highlights and scrolls the Info
  // panel's session-history node for the same entry (panel-hidden latch is
  // handled inside the panel).
  onJumpToEntry: (entryId) => {
    if (!infoPanel) return;
    infoPanel.selectEntry(entryId);
    infoPanel.scrollToSelectedEntry();
  },
});
const notifications = createNotificationCenter();
const tauriGlobal = /** @type {TauriGlobal} */ (globalThis);
const tauriInvoke = tauriGlobal.core?.invoke;
const sendNativeTaskNotification = createNativeTaskNotificationSender({
  invoke:
    typeof tauriInvoke === "function"
      ? /** @type {(command: string, args: Record<string, unknown>) => Promise<unknown>} */ (
          tauriInvoke
        )
      : undefined,
});
const taskCompletionNotifications = createTaskCompletionNotifications({
  resolveTask: (notificationTarget) => {
    const targetInfo =
      notificationTarget && typeof notificationTarget === "object"
        ? /** @type {{ sessionId?: string, workspaceId?: string }} */ (notificationTarget)
        : {};
    const found =
      sidebar?.sessions?.find(
        (/** @type {AppSidebarSession} */ session) =>
          session.id === targetInfo.sessionId && session.workspaceId === targetInfo.workspaceId,
      ) ?? null;
    return /** @type {{ name?: string, firstMessage?: string } | null} */ (found);
  },
  title: (task, error) =>
    task?.name ||
    task?.firstMessage ||
    (error ? t("settings.taskFailedTitle") : t("settings.taskCompleteTitle")),
  body: (_task, error) => error || t("settings.taskCompleteMessage"),
  showNotification: /** @type {(notification: unknown) => unknown} */ (sendNativeTaskNotification),
});

mountMessagesInsets(
  /** @type {Parameters<typeof mountMessagesInsets>[0]} */ (
    /** @type {unknown} */ ({
      main: document.querySelector(".main"),
      messages: messagesElement,
      header: document.querySelector(".header"),
      inputArea: document.querySelector(".input-area"),
      workspaceContent: document.querySelector(".workspace-content"),
    })
  ),
);
const messageRenderer = new MessageRenderer(/** @type {HTMLElement} */ (messagesElement), {
  sessionTreeActions: true,
});
const toolRenderer = new ToolCardRenderer(/** @type {HTMLElement} */ (messagesElement));
const input = chrome.composer.messageInput;
const form = chrome.composer.form;
const abortButton = chrome.composer.abortBtn;
const sendButton = chrome.composer.sendBtn;
const statusText = chrome.chat.statusText;
const statusIndicator = chrome.chat.statusIndicator;
const composerCard = chrome.composer.composerCard;
const commandButton = chrome.composer.commandBtn;
const attachButton = chrome.composer.attachBtn;
const imageInput = chrome.composer.imageInput;
const imagePreviews = chrome.composer.imagePreviews;
const skillSlashMenu = chrome.composer.skillSlashMenu;
const atFileMentionMenu = chrome.composer.atFileMentionMenu;
/** @type {ReturnType<typeof mountAtFileMention> | null} */
let atFileMention = null;
const composerAutoResize = mountComposerAutoResize({ input });
const queuedMessages = chrome.composer.queuedMessages;
const todoMirrorPanel = new RpivTodoMirrorPanel({
  container: /** @type {HTMLElement | null} */ (document.querySelector(".input-area")),
});
// pi-subagents' commands run inline over RPC without a model turn, so they go as prompts.
/** @param {string} command */
const runSubagentCommand = (command) =>
  runtime.request({ type: "prompt", message: command }, target, { idempotencyKey: randomId() });
configureSubagentView({ run: runSubagentCommand, t });
const subagentStrip = new SubagentStrip({
  container: /** @type {HTMLElement | null} */ (document.querySelector(".input-area")),
  t,
  onOpen: openSubagent,
  onStop: (runId, childId) => void runSubagentCommand(stopCommand(runId, childId)),
});
let undonePrompt = "";
const undoMarker = createUndoMarker({
  messages: /** @type {HTMLElement | null} */ (messagesElement),
  t,
  onRedo: () => void runSubagentCommand("/redo"),
});

// ── Composer model dropdown & thinking button ─────────────────────────────────
const modelDropdown = chrome.composer.modelDropdown;
const modelDropdownBtn = chrome.composer.modelDropdownBtn;
const modelDropdownLabel = chrome.composer.modelDropdownLabel;
const modelDropdownMenu = chrome.composer.modelDropdownMenu;
const thinkingBtn = chrome.composer.thinkingBtn;
/** @type {AppComposerModel} */
const composerModel = {
  thinkingLevel: "off",
  provider: null,
  modelId: null,
  contextWindow: 0,
  available: [],
  availableLoaded: false,
  scopedIds: [],
  scopedLoaded: false,
};

// Session UI state: persists per-session model + thinking level so switching
// between sessions restores the composer's model/thinking selection. Profiles
// live in the native host (SessionUiProfileStore) keyed by the runtime session
// id. Unsent composer text is intentionally NOT session-scoped: it follows the
// user across session switches instead of being saved/restored per session.
const sessionUiState = new SessionUiStateStore({
  profileClient: {
    load: () => {
      const sessionId = target.sessionId;
      if (!sessionId || sessionId === "pending-bootstrap") return Promise.resolve(null);
      return control.loadSessionUiProfile(sessionId);
    },
    save: (profile) => {
      const sessionId = target.sessionId;
      if (!sessionId || sessionId === "pending-bootstrap") return Promise.resolve(null);
      return control.saveSessionUiProfile(sessionId, profile);
    },
  },
});
let target = provisionalTargetFromRoute(route);
let configGatewayTargetReady = false;
/** @type {((value?: void) => void) | undefined} */
let resolveConfigGatewayReady;
const configGatewayReady = /** @type {Promise<void>} */ (
  new Promise((resolve) => {
    resolveConfigGatewayReady = () => {
      resolve(undefined);
    };
  })
);
let store = createSessionStore(target);
let navigationGeneration = 0;
let commandCatalog = buildCommandCatalog({});
const assistantMessageStream = createAssistantMessageStream();
/** @type {HTMLElement | null} */
let streamingElement = null;
/** @type {number | null} */
let streamingStartedAt = null;
/** @type {HTMLElement | null} */
let lastUserElement = null;
/** @type {unknown} */
let liveProcessGroup = null;
/** @type {string | null} */
let lastShownProviderError = null;
/** @type {AppSidebar | null} */
let sidebar = null;
// Sidebar loading starts before bootstrap/runtime awaits complete. Keep every
// state slot used by its callbacks initialized above that startup boundary so
// a fast session-list response cannot hit a temporal dead zone.
const sessionInfo = mountSessionInfo({
  toggle: chrome.chat.sessionInfoToggle,
  panel: chrome.chat.sessionInfoPanel,
  fileValue: chrome.chat.sessionInfoFile,
  idValue: chrome.chat.sessionInfoId,
  getTarget: () => target,
  getSessions: () => sidebar?.sessions ?? [],
});
function syncSessionInfo() {
  sessionInfo.refresh();
  const { id, session } = activeSession(
    () => target,
    () => sidebar?.sessions ?? [],
  );
  infoPanel?.updateSessionInfo({ filePath: session?.filePath || "", sessionId: id });
}
let activeSearchQuery = "";
// First user message of a session that has not been named yet. Kept across the
// awaits in session creation so a fast title event cannot land before the
// draft is recorded.
/** @type {string | null} */
let pendingBoundSessionFirstMessage = null;
/** @type {{ sessionId: string, messages: unknown[] } | null} */
let diskHistoryFallback = null;

const adapter = new HostRuntimeAdapter(
  /** @type {ConstructorParameters<typeof HostRuntimeAdapter>[0]} */ (
    /** @type {unknown} */ ({
      url: resolveHostWebSocketUrl(window),
      clientId: sessionScopedClientId("desktop"),
      clientType: "desktop",
    })
  ),
);
const terminalIntegration = mountTerminalPanel({
  adapter,
  getWorkspaceId: () => target.workspaceId,
});
const runtime = new RuntimeGateway(
  /** @type {import("./transport/runtime-gateway.js").RuntimeAdapter} */ (
    /** @type {unknown} */ (adapter)
  ),
);
const data = new HostDataGateway(
  /** @type {import("./transport/data-gateway.js").DataAdapter} */ (
    /** @type {unknown} */ (adapter)
  ),
  {
    fetchImpl: window.fetch.bind(window),
  },
);
const control = new HostControlGateway(
  /** @type {import("./transport/control-gateway.js").HostControlAdapter} */ (
    /** @type {unknown} */ (adapter)
  ),
);
/** @type {unknown[]} */
let piPackages = [];
async function refreshPiPackages() {
  try {
    piPackages = await control.listPiPackages();
  } catch {
    piPackages = [];
  }
  return piPackages;
}
/** @type {AppLateBindings} */
const lateBindings = {};
/** @type {ReturnType<typeof mountSessionCostBar> | undefined} */
let sessionCostBar;
const workbench = createSpopiWorkbench(
  /** @type {Parameters<typeof createSpopiWorkbench>[0]} */ (
    /** @type {unknown} */ ({
      getModelInfo: () => {
        const current = composerModel.available?.find(
          (model) =>
            model.provider === composerModel.provider && model.id === composerModel.modelId,
        );
        return {
          provider: composerModel.provider,
          id: composerModel.modelId,
          thinkingLevel: composerModel.thinkingLevel,
          contextWindow: composerModel.contextWindow,
          baseUrl: current?.baseUrl,
          thinkingBudgetField: current?.compat?.thinkingTokenBudgetField,
        };
      },
      scrapeEngine: (
        /** @type {{ baseUrl: string, metricsUrl: string }} */ { baseUrl, metricsUrl },
      ) => control.engineScrape(baseUrl, metricsUrl),
      onPinContext: (/** @type {unknown} */ item) => pinContext(target.sessionId || "", item),
      onDropContext: (/** @type {unknown} */ item) =>
        dropContext(item, (entryId) => config.call("drop_context", { entryId })),
      getWorkspaceId: () => target.workspaceId,
      getSessionPath: () => sessionCostBar?.activeSessionFile?.() || "",
      sendPrompt: (/** @type {string} */ message) =>
        runtime.request({ type: "prompt", message }, target, { idempotencyKey: randomId() }),
      getPackages: () => piPackages,
      installPackage: async (/** @type {string} */ source) => {
        await control.installPiPackage(source);
        await refreshPiPackages();
      },
      onOpenSettings: (/** @type {string | undefined} */ page) => {
        if (lateBindings.openSettings) {
          lateBindings.openSettings(page);
          return true;
        }
        chrome.sidebar.settingsBtn?.click();
      },
      onOpenFile: (/** @type {string} */ path, /** @type {number | undefined} */ line) =>
        lateBindings.openFile?.(path, line),
      onNavigateTree: (/** @type {unknown} */ payload) => {
        const id =
          typeof payload === "string"
            ? payload
            : /** @type {{ targetId?: string }} */ (payload)?.targetId;
        if (typeof id === "string") lateBindings.navigateTree?.(id);
      },
      onPanelShown: (/** @type {string} */ id) => lateBindings.onPanelShown?.(id),
      onDockTabChange: (/** @type {string} */ id) => {
        if (id === "terminal") void terminalIntegration?.panel?.expand();
      },
      openInTerminal: (/** @type {string} */ sessionPath) =>
        lateBindings.openInTerminal?.(sessionPath),
      onRunFile: (/** @type {string} */ path) => lateBindings.runFile?.(path),
      configCall: (
        /** @type {string} */ op,
        /** @type {Record<string, unknown> | undefined} */ params,
        /** @type {Record<string, unknown> | undefined} */ options,
      ) => lateBindings.configCall?.(op, params, options),
      loadHistoryCommands: async () => {
        const response = /** @type {{ response?: { data?: { commands?: unknown } } }} */ (
          await runtime.request({ type: "get_commands" }, target)
        );
        const commands = response?.response?.data?.commands;
        return Array.isArray(commands) ? commands : [];
      },
      loadShadowHistory: () =>
        control.shadowHistoryFiles(target.workspaceId || "", target.sessionId || ""),
    })
  ),
);
if (workbench.dock?.dataset.activeTab === "terminal") {
  void terminalIntegration?.panel?.expand();
}
void refreshPiPackages().then(() => workbench.refreshPackages?.());
const metricsOverlay = workbench.metricsOverlay;
const handleRuntimeEvent = createDeferredRuntimeHandler();
const preferences = new PreferenceGateway(control);
createUiStoreBinding(preferences);
void hydrateUiStore(preferences);
void hydrateThemePreference(preferences);
void hydrateLanguagePreference(preferences);
workbench.attachPreferences?.(preferences);
const config = new ConfigGateway(
  /** @type {ConstructorParameters<typeof ConfigGateway>[0]} */ (
    /** @type {unknown} */ ({
      runtime,
      getTarget: () => target,
      waitUntilReady: () => (configGatewayTargetReady ? Promise.resolve() : configGatewayReady),
    })
  ),
);
// OAuth login flows share the config transport; their __spopiOauth frames
// must be consumed before the config gateway sees them (design §5 M3).
const oauthGateway = createOauthGateway(
  /** @type {Parameters<typeof createOauthGateway>[0]} */ (
    /** @type {unknown} */ ({ runtime, getTarget: () => target })
  ),
);
lateBindings.configCall = (
  /** @type {string} */ op,
  /** @type {unknown} */ params,
  /** @type {unknown} */ options,
) =>
  config.call(
    op,
    /** @type {Record<string, unknown>} */ (params || {}),
    /** @type {{ timeoutMs?: number, target?: import("./transport/config-gateway.js").ConfigTarget | null } | undefined} */ (
      options
    ),
  );
void workbench.loadThinkingBudgets?.();
const customUiHost = document.createElement("div");
customUiHost.id = "spopi-custom-ui";
customUiHost.dataset.customTab = "custom-ui";
const customUiPanel = new CustomUiPanel({
  runtime,
  getTarget: () => target,
  container: customUiHost,
  onError: showError,
});
// Remembers which extension commands rely on terminal-only `ctx.ui` surfaces,
// so the slash menu can badge them instead of leaving the user with a command
// that silently does nothing.
const commandCompatibility = new ExtensionCommandCompatibility({
  workspaceId: target.workspaceId,
  onLearn: (record) => messageRenderer.renderSystemMessage(record.message),
});
const extensionWidgets = new ExtensionWidgets({
  aboveEditor: chrome.composer.widgetsAbove,
  belowEditor: chrome.composer.widgetsBelow,
});
const contextUsage = mountContextUsage();
const compactContextButton = chrome.chat.compactContextBtn;
const { panel: filePreviewPanel, openWorkspaceRelativePath } = mountFilePreview(
  /** @type {Parameters<typeof mountFilePreview>[0]} */ (
    /** @type {unknown} */ ({
      panel: chrome.filePreview.panel,
      resizer: chrome.filePreview.resizer,
      tabBar: chrome.filePreview.tabs,
      content: chrome.filePreview.content,
      controls: chrome.filePreview.controls,
      fileSidebarToggle: chrome.chat.fileSidebarToggle,
      mainContainer: /** @type {HTMLElement | null} */ (document.querySelector(".main")),
      getWorkspaceId: () => target.workspaceId,
      data,
      control,
      showError,
      onToggleChat: (/** @type {boolean} */ hidden) =>
        workbench.shell?.applyHidden?.({ chatHidden: Boolean(hidden) }),
    })
  ),
);
let promptTurnStart = 0;
const filePreviewFollow = createFilePreviewFollow(
  /** @type {Parameters<typeof createFilePreviewFollow>[0]} */ (
    /** @type {unknown} */ ({
      panel: filePreviewPanel,
      getWorkspacePath: async () => {
        try {
          const response = await data.workspaceInfo(target.workspaceId || "");
          const frame = /** @type {{ info?: { path?: string }, path?: string }} */ (response);
          return frame?.info?.path ?? frame?.path ?? "";
        } catch {
          return "";
        }
      },
      onWriteApplied: () => {
        files.hooks.scheduleRefresh();
      },
    })
  ),
);
const gitPanel = mountGitPanel(
  /** @type {Parameters<typeof mountGitPanel>[0]} */ (
    /** @type {unknown} */ ({
      runtime,
      getTarget: () => target,
      callConfig: (/** @type {string} */ op, /** @type {Record<string, unknown>} */ params) =>
        config.call(op, params),
      container: chrome.fileSidebar.gitPanel,
      fileSidebar: chrome.fileSidebar.sidebar,
      fileList: chrome.fileSidebar.fileList,
      onError: showNonFatalError,
      onSnapshot: () => {
        void workbench.refreshHistory?.();
      },
    })
  ),
);
setReviewSources(
  createReviewSources({
    control,
    t,
    getTarget: () => ({
      workspaceId: target.workspaceId || "",
      sessionId: target.sessionId || "",
      projectPath: /** @type {{ cwd?: string }} */ (store).cwd || "",
    }),
    isGitRepo: () => !gitPanel?.panel?.notGitRepo,
    uiRoot: async () => {
      const response = await fetch("/api/ui/overrides");
      if (!response.ok) return "";
      const body = /** @type {{ root?: string }} */ (await response.json());
      return typeof body.root === "string" ? body.root : "";
    },
    files: {
      readFile: async (/** @type {string} */ path) => {
        const response = await readFile(path, { workspaceId: target.workspaceId || "" });
        if (!response.ok) throw new Error("read_failed");
        const body = /** @type {{ content?: string, isBinary?: boolean, binary?: boolean }} */ (
          await response.json()
        );
        return {
          content: typeof body.content === "string" ? body.content : "",
          isBinary: body.isBinary === true || body.binary === true,
        };
      },
    },
    git: {
      // Ask git directly: the Git panel only loads status once it has been opened.
      status: async () => {
        const frame = /** @type {{ snapshot?: { entries?: unknown[] } } | null} */ (
          await runtime.git({ type: "status" }, target)
        );
        const snapshot = frame?.snapshot ?? frame;
        return snapshot && Array.isArray(/** @type {any} */ (snapshot).entries)
          ? snapshot
          : gitPanel?.panel?.snapshot || { entries: [] };
      },
      fileAtHeadText: (/** @type {string} */ id) =>
        gitPanel?.client.fileAtHeadText(id) ?? Promise.resolve({ content: "", exists: false }),
    },
  }),
);
setReviewSend((message, { queue } = {}) => {
  const working = store.lifecycle === "working";
  const type = !working ? "prompt" : queue ? "follow_up" : "steer";
  return runtime.request({ type, message }, target, { idempotencyKey: randomId() });
});
setReviewCommands({
  has: (name) => [...commandCatalog.values()].some((command) => command?.name === name),
  run: (command) =>
    runtime.request({ type: "prompt", message: command }, target, { idempotencyKey: randomId() }),
});

// ── Info panel (session tree + workspace actions) ─────────────────────
const infoSidebarState = mountInfoSidebar(
  /** @type {Parameters<typeof mountInfoSidebar>[0]} */ (
    /** @type {unknown} */ ({
      infoSidebar: chrome.sidePanels.info,
      panel: chrome.sidePanels.infoPanel,
      infoClose: chrome.sidePanels.infoClose,
      infoRefresh: chrome.sidePanels.infoRefresh,
      infoSidebarToggle: chrome.chat.infoSidebarToggle,
      fileSidebar: chrome.fileSidebar.sidebar,
      control,
      t,
      data,
      runtime,
      getTarget: () => target,
      getStore: () => store,
      config,
      hydrateSnapshot: () => hydrateSnapshotOnce(),
      syncSessionInfo,
    })
  ),
);
const { infoSidebar, infoPanel, refreshInfoPanel, navigateActiveTree } = infoSidebarState;

const files = connectFileTree(
  /** @type {Parameters<typeof connectFileTree>[0]} */ (
    /** @type {unknown} */ ({
      data,
      control,
      preferences,
      runtime,
      getTarget: () => target,
      getWorkspaceId: () => target.workspaceId,
      openWorkspaceRelativePath,
      filePreviewPanel,
      getAtFileMention: () => atFileMention,
      input,
      buildAtMentionValue,
      composerAutoResize,
      showError,
      openFilesPanel,
      openGitPanel,
      isMacOS,
      isFilePanelShortcut,
      onRunFile: (/** @type {string} */ path) => lateBindings.runFile?.(path),
      fileList: chrome.fileSidebar.fileList,
      pathEl: chrome.fileSidebar.path,
      sidebarEl: chrome.fileSidebar.sidebar,
      upBtn: chrome.fileSidebar.up,
      refreshBtn: chrome.fileSidebar.refresh,
      toggleHiddenBtn: chrome.fileSidebar.toggleHidden,
      collapseBtn: chrome.fileSidebar.collapse,
      finderBtn: chrome.fileSidebar.finder,
      closeBtn: chrome.fileSidebar.close,
      fileSidebarToggle: chrome.chat.fileSidebarToggle,
      diffSidebarToggle: chrome.chat.diffSidebarToggle,
    })
  ),
);

/**
 * Header Files / Git own one view each. Opening the active view closes the
 * panel; opening the other view switches content without an in-panel tab bar.
 * @param {string} view
 */
function openWorkspacePanel(view) {
  const sidebar = chrome.fileSidebar.sidebar;
  const result = toggleExclusiveSideView(sidebar, {
    // Files / Git / Info are one exclusive group: opening any view collapses
    // BOTH other side panels (Info shares the right rail, not a tab bar).
    otherPanels: [infoSidebar],
    currentView: gitPanel?.getTab?.() ?? "files",
    nextView: view,
  });
  if (!result.open) return false;
  gitPanel?.setTab(view);
  return true;
}

function openFilesPanel() {
  const opened = openWorkspacePanel("files");
  const tree = files.tree;
  if (opened && tree && !tree.loaded) tree.load().catch(showError);
}

function openGitPanel() {
  openWorkspacePanel("git");
}

sessionCostBar = mountSessionCostBar(
  /** @type {Parameters<typeof mountSessionCostBar>[0]} */ (
    /** @type {unknown} */ ({
      sessionCostEl: chrome.chat.sessionCost,
      t,
      onTotalsChange: (/** @type {{ input?: number, output?: number }} */ totals) =>
        contextUsage.setSessionTotals(totals),
      runtime,
      getTarget: () => target,
      getSessions: () => sidebar?.sessions ?? [],
      getCwd: () => /** @type {{ cwd?: string }} */ (store).cwd,
    })
  ),
);
const { headerStatusBar, hydrateHeaderSessionStats, computeTotalCostFromMessages, setSessionCost } =
  sessionCostBar;

// Compact coordinator: a single state machine that distinguishes the RPC
// acknowledgement from Pi's actual compaction_start/compaction_end lifecycle
// events. This prevents duplicate requests and ensures the UI only returns to
// idle when compaction truly completes (or fails).
const compactCoordinator = createCompactCoordinator({
  send: async () => {
    const customInstructions = compactPreserveInstructions(target.sessionId || "");
    const command = customInstructions
      ? { type: "compact", customInstructions }
      : { type: "compact" };
    const frame = await runtime.request(command, target, {
      idempotencyKey: randomId(),
    });
    // runtime.request resolves with the full runtime_response frame; the pi
    // compact result lives in frame.response. Extract it so the coordinator
    // sees { success, data } rather than the transport envelope.
    return frame?.response ?? { success: false };
  },
  onState: (state) => {
    contextUsage.setCompacting(state === "requested" || state === "running");
  },
});

async function requestManualCompaction() {
  const compaction =
    store.compaction && typeof store.compaction === "object"
      ? /** @type {{ status?: string }} */ (store.compaction)
      : {};
  if (
    !contextUsage.canCompact ||
    store.lifecycle === "working" ||
    compaction.status === "running" ||
    compactCoordinator.busy
  )
    return;
  await compactCoordinator.request();
}

compactContextButton?.addEventListener("click", () => requestManualCompaction().catch(showError));
const extensionUi = new ExtensionUiHost({
  runtime,
  showDialog: (request, opts) => showNativeDialog(request, undefined, opts),
  showInlinePrompt: (request, opts) =>
    showInlineExtensionPrompt(request, {
      container: messagesElement,
      onAnswered: (card) => lateBindings.continueLiveTurnBelow?.(card),
      ...opts,
    }),
  hooks: {
    notify: (request) => {
      // Configuration data-plane responses arrive as notify events; swallow
      // them so they don't render as chat messages.
      if (config.consumeNotify(request)) return;
      // Custom extension UI panels (ctx.ui.custom) are bridged over notify too;
      // they render as an overlay rather than a transcript entry.
      if (customUiPanel.consumeNotify(request)) {
        workbench.center?.openCustomTab?.("custom-ui", "Extension", customUiHost);
        return;
      }
      // Terminal-only capability reports are a data plane as well; the store
      // renders its own one-line explanation through onLearn.
      if (commandCompatibility.consumeNotify(request)) return;
      // rpiv-todo's /todos command emits a centered notify transcript. SPOPI
      // already mirrors the same state natively, so expand the panel instead
      // of rendering a duplicate system message. When nothing is mirrored (the
      // panel stays hidden, e.g. "No todos yet"), fall through and render the
      // message so /todos is never a silent no-op.
      if (isRpivTodoCommandNotify(request.message) && todoMirrorPanel.hasVisibleTasks) {
        todoMirrorPanel.expand();
        return;
      }
      // /undo and /redo move Pi's session tree without an event; the chat is rebuilt from
      // the new position so it shows what the model now sees, and a marker holds the undone turn.
      const history = historyNotice(request.message);
      if (history) {
        // /undo puts the undone prompt in the composer; after /redo that text would run it twice.
        if (history.kind === "undo") undonePrompt = input?.value || "";
        else if (input && undonePrompt && input.value === undonePrompt) {
          input.value = "";
          composerAutoResize.sync();
        }
        void hydrateSnapshotOnce()
          .then(() => {
            if (history.kind === "undo") undoMarker.show(history);
            else undoMarker.clear();
          })
          .catch(showError);
        return;
      }
      // Extensions repeat config warnings on every session start and restart; say each
      // one once per session.
      if (request.notifyType === "warning" && !firstNoticeInSession(request.message)) return;
      paintExtensionNotice(messagesElement, request);
    },
    title: (request) => {
      if (typeof request.title === "string" && request.title) document.title = request.title;
    },
    editorText: (request) => {
      if (!input) return;
      input.value = typeof request.text === "string" ? request.text : String(request.text ?? "");
      composerAutoResize.sync();
      input.focus();
    },
    widget: (request) => {
      // rpiv-todo owns the tool/reducer; SPOPI renders a native mirror from
      // the persisted todo tool-result snapshots instead of the TUI widget.
      if (isRpivTodoWidgetRequest(/** @type {{ method?: string, widgetKey?: string }} */ (request)))
        return;
      // pi-subagents sends machine-readable JSON on its widget keys for hosts like this one.
      const widget = /** @type {{ method?: string, widgetKey?: string, widgetLines?: unknown }} */ (
        request
      );
      if (isSubagentWidget(widget)) {
        if (widget.widgetKey === INSPECT_WIDGET) {
          const reply = parseInspect(widget.widgetLines);
          if (reply) applySubagentInspect(reply);
          return;
        }
        const runs = parseRuns(widget.widgetLines);
        subagentStrip.setRuns(runs);
        noteSubagentRuns(runs);
        return;
      }
      // Everything else falls back to the generic renderer, so an extension
      // that publishes a status panel is not silently dropped.
      extensionWidgets.apply(
        /** @type {import("./extension-ui/extension-widgets.js").SetWidgetRequest} */ (
          /** @type {unknown} */ (request)
        ),
      );
    },
  },
});
sessionStatus.bind({
  abortButton,
  composerCard,
  getSessionId: () => target.sessionId,
  hasPending: (sessionId) =>
    typeof sessionId === "string" ? extensionUi.hasPending(sessionId) : false,
  sendButton,
  statusIndicator,
  statusText,
});
metricsOverlay.bind({ statusIndicator, statusText });
await extensionUi.setForegroundSession(target.sessionId || "", { flush: false });
await extensionUi.flushForegroundQueue();

const historyLate = {
  /** @type {(next?: unknown, opts?: unknown) => Promise<void> | void} */
  adoptTarget: async () => {},
  /** @type {(messages?: unknown[]) => void} */
  dispatchSnapshot() {},
  /** @type {(model?: unknown) => void} */
  updateComposerModel() {},
  /** @type {(level?: unknown) => void} */
  updateComposerThinking() {},
  /** @type {(options: { piModel?: unknown, inheritLastModel?: boolean }) => Promise<void> | void} */
  syncComposerWithPi() {},
};
const {
  renderHistory,
  showLiveProcessIndicator,
  streamHost,
  releaseAnswer,
  adoptStreamingMessage,
  foldStepIntoLiveTurn,
  continueLiveTurnBelow,
  setLiveStep,
  finishLiveTurn,
  hydrateFromSnapshot,
} = mountHistory(
  /** @type {Parameters<typeof mountHistory>[0]} */ (
    /** @type {unknown} */ ({
      workbench,
      messagesElement,
      extensionUi,
      messageRenderer,
      toolRenderer,
      t,
      getTarget: () => target,
      applyActiveSearchHighlight,
      getLiveProcessGroup: () => liveProcessGroup,
      setLiveProcessGroup: (/** @type {unknown} */ group) => {
        liveProcessGroup = group;
      },
      getDiskHistoryFallback: () => diskHistoryFallback,
      getStore: () => store,
      setStore: (/** @type {unknown} */ next) => {
        store = /** @type {ReturnType<typeof createSessionStore>} */ (next);
      },
      todoMirrorPanel,
      queuedMessages,
      cancelQueueItem,
      convNav,
      setStatus,
      refreshPiPackages,
      contextUsage,
      composerModel,
      runtime,
      setSessionCost,
      computeTotalCostFromMessages,
      hydrateHeaderSessionStats,
      late: historyLate,
    })
  ),
);
lateBindings.continueLiveTurnBelow = continueLiveTurnBelow;
/** @type {Map<string, Set<string>>} */
const noticesShown = new Map();

/** @param {unknown} message */
function firstNoticeInSession(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return true;
  const key = target.sessionId || "";
  const seen = noticesShown.get(key) ?? new Set();
  noticesShown.set(key, seen);
  if (seen.has(text)) return false;
  seen.add(text);
  return true;
}

document.addEventListener("spopi-notice", (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  if (detail && typeof detail.message === "string") paintExtensionNotice(messagesElement, detail);
});

/** @param {unknown} event */
function isExtensionUiRequest(event) {
  return /** @type {{ type?: string } | null} */ (event)?.type === "extension_ui_request";
}

runtime.subscribe((frame) => {
  const runtimeFrame = /** @type {{ type?: string, event?: unknown }} */ (frame);
  if (runtimeFrame.type === "extension_ui_resolved") {
    handleRuntimeEvent(
      /** @type {import("./chat/runtime-events.js").RuntimeEventFrame} */ (frame),
    ).catch(showError);
    return;
  }
  if (runtimeFrame.type !== "runtime_event") return;
  taskCompletionNotifications.handleRuntimeFrame(frame);
  const previous = store;
  const routed = routeRuntimeFrame(
    /** @type {Parameters<typeof routeRuntimeFrame>[0]} */ (
      /** @type {unknown} */ ({
        frame,
        target,
        store,
        consumeConfigResponse: (/** @type {unknown} */ candidate) => {
          // M3 mutual exclusion: OAuth envelopes are consumed first and never
          // reach the config gateway or chat rendering.
          if (
            oauthGateway.consumeFrame(
              /** @type {Parameters<typeof oauthGateway.consumeFrame>[0]} */ (candidate),
            )
          )
            return true;
          return consumeConfigResponseFrame(
            config,
            /** @type {Parameters<typeof consumeConfigResponseFrame>[1]} */ (candidate),
          );
        },
        reduceForeground: reduceSessionState,
      })
    ),
  );
  if (routed.kind === "background" || routed.kind === "consumed-background") {
    if (routed.kind === "background")
      handleBackgroundRuntimeEvent(
        /** @type {Parameters<typeof handleBackgroundRuntimeEvent>[0]} */ (
          /** @type {unknown} */ (frame)
        ),
      ).catch(showError);
    return;
  }
  store = /** @type {ReturnType<typeof createSessionStore>} */ (routed.store);
  if (!previous.snapshotRequired && store.snapshotRequired) {
    // Use hydrateSnapshotOnce to deduplicate concurrent calls (e.g. when the
    // subscriber fires at the same time as the startup try-block) and to
    // silently retry on brief WebSocket disconnections that can occur during
    // project switches, instead of rendering error messages that are quickly
    // overwritten once the connection stabilises.
    hydrateSnapshotOnce().catch(showError);
    // After a reload the host replays open questions and the latest statuses with their
    // old sequence. The snapshot carries neither, so apply them anyway.
    if (!isExtensionUiRequest(runtimeFrame.event)) return;
  }
  if (previous.queue !== store.queue) {
    renderQueuedMessages(queuedMessages, store.queue, { onCancel: cancelQueueItem });
  }
  if (routed.kind === "consumed-foreground") return;
  handleRuntimeEvent(
    /** @type {import("./chat/runtime-events.js").RuntimeEventFrame} */ (runtimeFrame.event),
  ).catch(showError);
});
createConfigGatewayConnectionListener({
  adapter,
  isReady: () => configGatewayTargetReady,
  onDisconnected: () => setStatus("disconnected"),
});
adapter.connect();

/** @type {ReturnType<typeof mountSettingsPanel> | undefined} */
let settingsPanel;
/** @type {() => void} */
let openComposerModelPicker = () => {};
const sendModelGate = createSendModelGate({
  sendButton,
  t,
  notify: notifications.notify,
  openModelPicker: () => openComposerModelPicker(),
  openModelSettings: () => settingsPanel?.openSettings("models"),
});
const {
  updateComposerModel,
  updateComposerThinking,
  loadAvailableModels,
  loadScopedModelIds,
  openModelPicker,
} = mountModelControls(
  /** @type {Parameters<typeof mountModelControls>[0]} */ (
    /** @type {unknown} */ ({
      state: composerModel,
      thinkingBtn,
      modelDropdown,
      modelDropdownBtn,
      modelDropdownLabel,
      modelDropdownMenu,
      sessionUiState,
      contextUsage,
      runtime,
      getTarget: () => target,
      config,
      t,
      onLocaleChange,
      showError,
      openModelSettings: () => settingsPanel?.openSettings("models"),
      onThinkingUnavailable: () =>
        notifications.notify({
          type: "info",
          title: t("composer.noThinkingLevels"),
          message: t("composer.noThinkingLevelsHint"),
          action: {
            label: t("composer.openModelSettings"),
            onClick: () => settingsPanel?.openSettings("models"),
          },
        }),
      onModelStatusChange: sendModelGate.setStatus,
    })
  ),
);
openComposerModelPicker = openModelPicker;
const composerPiSync = createComposerPiSync(
  /** @type {Parameters<typeof createComposerPiSync>[0]} */ (
    /** @type {unknown} */ ({
      runtime,
      config,
      getTarget: () => target,
      randomId,
      updateComposerModel,
      updateComposerThinking,
      notify: notifications.notify,
      openModelPicker,
      t,
    })
  ),
);
historyLate.syncComposerWithPi = composerPiSync.sync;
const modelConfigRefresh = createModelConfigRefresh(
  /** @type {Parameters<typeof createModelConfigRefresh>[0]} */ (
    /** @type {unknown} */ ({
      runtime,
      config,
      getTarget: () => target,
      getSelection: () => ({ provider: composerModel.provider, modelId: composerModel.modelId }),
      isStreaming: () => streamingStartedAt != null,
      updateComposerModel,
      updateComposerThinking,
      notify: notifications.notify,
      t,
      randomId,
    })
  ),
);
historyLate.updateComposerModel = /** @type {(model?: unknown) => void} */ (updateComposerModel);
historyLate.updateComposerThinking = /** @type {(level?: unknown) => void} */ (
  updateComposerThinking
);

const bootstrap = createSessionRuntime(
  /** @type {import("./session/session-runtime.js").SessionRuntimeDeps} */ (
    /** @type {unknown} */ ({
      get target() {
        return target;
      },
      set target(value) {
        target = value;
      },
      get store() {
        return store;
      },
      set store(value) {
        store = value;
      },
      get snapshotInFlight() {
        return snapshotInFlight;
      },
      set snapshotInFlight(value) {
        snapshotInFlight = value;
      },
      get commandCatalog() {
        return commandCatalog;
      },
      set commandCatalog(value) {
        commandCatalog = value;
      },
      get diskHistoryFallback() {
        return diskHistoryFallback;
      },
      set diskHistoryFallback(value) {
        diskHistoryFallback = value;
      },
      get navigationGeneration() {
        return navigationGeneration;
      },
      set navigationGeneration(value) {
        navigationGeneration = value;
      },
      get configGatewayTargetReady() {
        return configGatewayTargetReady;
      },
      set configGatewayTargetReady(value) {
        configGatewayTargetReady = value;
      },
      get infoTreeSeq() {
        return infoSidebarState.infoTreeSeq;
      },
      set infoTreeSeq(value) {
        infoSidebarState.infoTreeSeq = value;
      },
      get streamingElement() {
        return streamingElement;
      },
      set streamingElement(value) {
        streamingElement = value;
      },
      get streamingStartedAt() {
        return streamingStartedAt;
      },
      set streamingStartedAt(value) {
        streamingStartedAt = value;
      },
      get liveProcessGroup() {
        return liveProcessGroup;
      },
      set liveProcessGroup(value) {
        liveProcessGroup = value;
      },
      get sidebar() {
        return sidebar;
      },
      set sidebar(/** @type {unknown} */ value) {
        sidebar = /** @type {AppSidebar | null} */ (value);
      },
      get slashMenu() {
        return slashMenu;
      },
      get headerStatusBar() {
        return headerStatusBar;
      },
      get infoSidebar() {
        return infoSidebar;
      },
      runtime,
      adapter,
      data,
      history,
      convNav,
      extensionUi,
      input,
      composerAutoResize,
      queuedMessages,
      todoMirrorPanel,
      extensionWidgets: {
        clear: () => {
          extensionWidgets.clear();
          subagentStrip.clear();
          resetSubagentView();
          undoMarker.clear();
        },
      },
      customUiPanel,
      filePreviewFollow,
      assistantMessageStream,
      files,
      config,
      control,
      sessionUiState,
      infoPanel,
      messageRenderer,
      toolRenderer,
      route,
      setStatus,
      showError,
      renderHistory,
      hydrateFromSnapshot,
      resolveConfigGatewayReady,
      signalConfigGatewayReady,
      cancelQueueItem,
      syncSessionInfo,
      hydrateHeaderSessionStats,
      setSessionCost,
      updateComposerModel,
      updateComposerThinking,
      syncComposerWithPi: composerPiSync.sync,
      refreshInfoPanel,
      mountProjectHeader,
      mountHeaderOpenApp,
      loadAvailableModels,
      spawnSessionViaHost,
      openSessionInProjectViaHost,
      buildCommandCatalog,
      commandCompatibility,
      createSessionStore,
      set activeSearchQuery(/** @type {string} */ value) {
        activeSearchQuery = value;
      },
      mountSessionSidebar,
      createSessionSelectionHandler,
      SessionSidebar,
      mountSessionSearchDialog,
      createSessionViaHost,
      applyActiveSearchHighlight,
      replaceTemporarySessionRoute,
    })
  ),
);
const { hydrateSnapshotOnce, adoptTarget, handleBackgroundRuntimeEvent, setupSessionSidebar } =
  bootstrap;
historyLate.adoptTarget = /** @type {(next?: unknown, opts?: unknown) => Promise<void> | void} */ (
  adoptTarget
);
historyLate.dispatchSnapshot = /** @type {(messages?: unknown[]) => void} */ (
  (/** @type {unknown[]} */ messages) => {
    bootstrap.dispatch({
      type: "snapshot",
      messages: /** @type {import("./chat/transcript-reducer.js").TranscriptMessage[]} */ (
        /** @type {unknown} */ (messages)
      ),
    });
  }
);
historyLate.updateComposerModel = /** @type {(model?: unknown) => void} */ (updateComposerModel);
historyLate.updateComposerThinking = /** @type {(level?: unknown) => void} */ (
  updateComposerThinking
);

// Wire DOM-only event handlers immediately, before any network awaits, so the
// UI (settings overlay, file browser, composer, abort) stays responsive even
// when the runtime connection is slow, hangs, or fails. Previously these were
// attached after `await adapter.ready()/hydrateSnapshot()/loadCommands()`, so a
// stalled runtime left the settings button dead ("can't open settings").
setupSessionSidebar();
{
  const sessionSidebar = /** @type {AppSidebar | null} */ (sidebar);
  void hydrateUiStore(preferences).then(() => {
    sessionSidebar?.reloadUiPrefs?.();
    refreshResizablePanels();
    showProjectsFolderFallback(notifications, () => settingsPanel?.openSettings("general"));
  });
  void sessionSidebar?.load?.()?.catch(showError);
}
mountSidebarToggle();
if (atFileMentionMenu) {
  // @-file mention completion must be wired before the Enter-to-send listener
  // so it can intercept Enter/Tab/Escape while its listbox is open.
  atFileMention = mountAtFileMention(
    /** @type {Parameters<typeof mountAtFileMention>[0]} */ (
      /** @type {unknown} */ ({
        input,
        container: atFileMentionMenu,
        getWorkspaceRoot: () => target.workspaceId,
      })
    ),
  );
}
const pasteOffload = mountComposerPasteOffload({
  textarea: input,
  container: chrome.composer.composerCard,
  offload: async (content) => {
    const result = await config.call("write_paste_offload", { content });
    if (!result?.ok || typeof result.data?.path !== "string") {
      throw new Error(result?.error || "Paste offload failed");
    }
    return result.data.path;
  },
  t,
});
abortButton?.addEventListener("click", abortCurrentRun);
mountChatFileActions(
  /** @type {Parameters<typeof mountChatFileActions>[0]} */ (
    /** @type {unknown} */ ({
      runtime: bootstrap,
      messagesElement,
      filePreviewFollow,
      terminalIntegration,
      workbench,
      lateBindings,
      showError,
    })
  ),
);
mountMessageForkHandler(
  /** @type {Parameters<typeof mountMessageForkHandler>[0]} */ (
    /** @type {unknown} */ ({
      messagesElement,
      getStore: () => store,
      getTarget: () => target,
      runtime,
      randomId,
      showError: showNonFatalError,
      t,
      getDiskHistoryFallback: () => diskHistoryFallback,
      setDiskHistoryFallback: (/** @type {unknown} */ value) => {
        diskHistoryFallback = /** @type {{ sessionId: string, messages: unknown[] } | null} */ (
          value
        );
      },
      hydrateSnapshotOnce,
      adoptForkedSession: checkAndAdoptForkedSession,
      navigateTree: navigateActiveTree,
      input,
      composerAutoResize,
    })
  ),
);

// Pi switches to the forked session as soon as `fork` returns, but writes its
// file only with the first prompt. Adopt the new id right away and add a
// sidebar row for it; the settle-time check below then refreshes from disk.
/** @type {typeof target | null} */
let pendingForkSwitchCheck = null;
async function checkAndAdoptForkedSession({ fromSessionId = null } = {}) {
  try {
    const statsResult = await runtime.request({ type: "get_session_stats" }, target);
    const statsData = /** @type {{ sessionId?: string, sessionFile?: string }} */ (
      statsResult?.response?.data ?? {}
    );
    if (!statsData.sessionId) return;
    if (statsData.sessionId === target.sessionId) {
      await sidebar?.load?.({ quiet: true });
      return;
    }
    // Tell the host registry about the identity change *before* adopting it
    // locally. adoptTarget resubscribes to events for the new target tuple;
    // if the registry still thinks this instance is on the old session id,
    // the resubscription won't match the events this instance actually
    // emits (tagged with whatever the registry believes), and this client
    // silently stops receiving any runtime events at all.
    const rebound = await runtime.rebindSession(target, statsData.sessionId);
    if (!rebound) return;
    const parent = sidebar?.sessions?.find((session) => session.id === fromSessionId);
    await adoptTarget(rebound, { updateRoute: true });
    if (fromSessionId) {
      sidebar?.upsertSession?.({
        id: rebound.sessionId,
        filePath: statsData.sessionFile ?? "",
        firstMessage: parent?.name || parent?.firstMessage || null,
        timestamp: new Date().toISOString(),
        modifiedAtMs: Date.now(),
        isCurrentWorkspace: true,
      });
      pendingForkSwitchCheck = { ...target };
    } else {
      await sidebar?.load?.({ quiet: true });
    }
    await hydrateSnapshotOnce();
  } catch (error) {
    showError(error);
  }
}
chrome.sidebar.refreshSessionsBtn?.addEventListener("click", (e) => {
  const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
  btn.classList.remove("spinning");
  // Force reflow so re-adding the class restarts the animation
  void btn.offsetWidth;
  btn.classList.add("spinning");
  void sidebar?.load?.()?.catch(showError);
});
files.setup();
lateBindings.openFile = (/** @type {string} */ path, /** @type {number | undefined} */ line) =>
  filePreviewPanel?.openFile?.(path, { line });
lateBindings.navigateTree = (/** @type {string} */ entryId) => navigateActiveTree(entryId);
lateBindings.onPanelShown = (/** @type {string} */ id) => {
  // Leaving Git gives the file sidebar its tree and header buttons back.
  if (id !== "git" && gitPanel?.getTab?.() === "git") gitPanel.setTab?.("files");
  files.hooks.onPanelShown(id);
  if (id === "git") {
    gitPanel?.setTab?.("git");
    /** @type {{ refresh?: () => void }} */ (gitPanel)?.refresh?.();
  }
};
lateBindings.openInTerminal = async (/** @type {string} */ sessionPath) =>
  openSessionInPtyTwin(
    /** @type {Parameters<typeof openSessionInPtyTwin>[0]} */ (
      /** @type {unknown} */ ({
        workbench,
        sessionPath: await resolveResumePath(sessionPath, () =>
          runtime.request({ type: "get_session_stats" }, target),
        ),
        currentSessionId: target.sessionId,
        getClient: () => terminalIntegration?.client,
        getPanel: () => terminalIntegration?.panel,
      })
    ),
  );
const imageAttachments = mountComposerImageAttachments({
  input,
  attachButton,
  imageInput,
  previewContainer: imagePreviews,
  dropTarget: composerCard,
  onError: showError,
});
mountComposer(
  /** @type {Parameters<typeof mountComposer>[0]} */ (
    /** @type {unknown} */ ({
      input,
      form,
      pasteOffload,
      imageAttachments,
      composerAutoResize,
      commandCompatibility,
      runtime,
      messageRenderer,
      settingsButton: chrome.sidebar.settingsBtn,
      showError,
      getStore: () => store,
      getTarget: () => target,
      getCommandCatalog: () => commandCatalog,
      clearPendingFork: () => {
        pendingForkSwitchCheck = null;
      },
      allowPrompt: sendModelGate.allowPrompt,
    })
  ),
);
const slashMenu = mountComposerSlashMenu(
  /** @type {Parameters<typeof mountComposerSlashMenu>[0]} */ (
    /** @type {unknown} */ ({
      input,
      container: skillSlashMenu,
      commandButton,
      getCommands: () => commandCompatibility.decorate(commandCatalog.values()),
    })
  ),
);
mountGuardChip(config);
mountUiReload(adapter);
settingsPanel = mountSettingsPanel(
  /** @type {Parameters<typeof mountSettingsPanel>[0]} */ (
    /** @type {unknown} */ ({
      data,
      control,
      preferences,
      terminal: terminalIntegration,
      getWorkspaceId: () => target.workspaceId,
      configGateway: config,
      oauthGateway,
      onModelConfigurationChanged: (
        /** @type {import("./composer/model-config-refresh.js").ModelConfigChange | undefined} */ change,
      ) => {
        // Auth or visibility edits invalidate both caches; refetch authoritatively.
        composerModel.scopedLoaded = false;
        loadScopedModelIds({ force: true });
        loadAvailableModels({ force: true });
        modelConfigRefresh.onModelConfigurationChanged(change);
      },
      runtime,
      getTarget: () => target,
      onError: showError,
      notify: notifications.notify,
      onRestarted: () => window.location.reload(),
      onCommandsReloaded: async () => {
        const response = /** @type {{ response?: { data?: { commands?: unknown } } }} */ (
          await runtime.request({ type: "get_commands" }, target)
        );
        const commands = response?.response?.data?.commands;
        commandCatalog = buildCommandCatalog({
          commands: Array.isArray(commands) ? commands : [],
        });
      },
      onThinkingLevelChanged: (
        /** @type {string | null | undefined} */ level,
        /** @type {{ sessionId?: string } | null | undefined} */ changedTarget,
      ) => {
        if (changedTarget?.sessionId === target.sessionId) updateComposerThinking(level);
      },
    })
  ),
);
lateBindings.openSettings = (/** @type {string | undefined} */ tab) =>
  settingsPanel?.openSettings(tab || "general");
void maybeShowFirstRun({
  preferences,
  control,
  openSettings: (tab) => lateBindings.openSettings?.(tab),
});
document.addEventListener("spopi-show-first-run", () => {
  settingsPanel?.closeSettings({ clearHash: true });
  void maybeShowFirstRun({
    preferences,
    control,
    openSettings: (tab) => lateBindings.openSettings?.(tab),
    force: true,
  });
});
document.addEventListener("spopi-open-phone", () => settingsPanel?.openSettings("phone"));
document.addEventListener("spopi-open-settings", (event) => {
  const tab = /** @type {CustomEvent<{ tab?: string }>} */ (event).detail?.tab;
  settingsPanel?.openSettings(tab || "general");
});
mountAppUpdater(
  /** @type {Parameters<typeof mountAppUpdater>[0]} */ (/** @type {unknown} */ ({ settingsPanel })),
);
mountNewSessionButton({ control, onError: showError });

// SPA session creation: workspace-actions emits session.created. Adopt it
// in-page so the window never reloads.
onSessionCreated((detail) => {
  if (!detail?.sessionId || !detail?.workspaceId) return;
  const nextTarget = {
    workspaceId: detail.workspaceId,
    sessionId: detail.sessionId,
    instanceId: detail.instanceId || `pending-${detail.sessionId.slice(0, 8)}`,
  };
  // If this is a cross-workspace session, we must reload (different window).
  // Same-workspace sessions adopt in-page.
  if (nextTarget.workspaceId !== target.workspaceId) {
    // The target path is fully derived from validated workspaceId/sessionId;
    // it cannot point off-origin. Build with explicit origin and verify before
    // assigning to window.location.href.
    const target = new URL(
      "/app/workspaces/" +
        encodeURIComponent(nextTarget.workspaceId) +
        "/sessions/" +
        encodeURIComponent(nextTarget.sessionId),
      window.location.origin,
    );
    // pi-lens ignores this branch: target.origin === window.location.origin
    // is statically provable (URL was built against window.location.origin),
    // so this assignment is always safe.
    if (target.origin === window.location.origin) {
      window.location.assign(target.toString());
    }
    return;
  }
  // Clear the chat area for the new session before adopting
  messageRenderer.clear();
  toolRenderer.clear();
  void adoptTarget(nextTarget).then(() => {
    if (!input) return;
    input.value = "";
    composerAutoResize.sync();
    input.focus();
    // Hydrate the new session's state from Pi
    hydrateSnapshotOnce().catch(showError);
  });
});

mountOpenFolderButton({ onError: showError });
mountAppKeyboardShortcuts({
  input,
  abort: abortCurrentRun,
  isWorking: () => store.lifecycle === "working",
});
convNav.mount();

await bootstrap.start();

/** @param {{ workspaceId?: string, sessionId?: string }} currentRoute */
function provisionalTargetFromRoute(currentRoute) {
  return {
    workspaceId: currentRoute.workspaceId,
    sessionId: currentRoute.sessionId,
    instanceId: "pending-bootstrap",
  };
}

function mountSidebarToggle() {
  setupFileSidebarToggle({
    mountResizablePanel:
      /** @type {Parameters<typeof setupFileSidebarToggle>[0]["mountResizablePanel"]} */ (
        /** @type {unknown} */ (mountResizablePanel)
      ),
    sidebarEl: chrome.sidebar.sidebar,
    toggleBtn: chrome.chat.sidebarToggle,
    overlay: chrome.sidebar.overlay,
    fileSidebarEl: chrome.fileSidebar.sidebar,
  });
}

function promptUserEntryId() {
  const nodes = messagesElement?.querySelectorAll(".message.user[data-entry-id]");
  const last = nodes && nodes.length > 0 ? nodes[nodes.length - 1] : null;
  return last instanceof HTMLElement ? last.dataset.entryId || "" : "";
}

function mountTurnReviewCard() {
  const turns = bootstrap.getState()?.transcript?.turns || [];
  const files = mergeTurnFiles(turns.slice(promptTurnStart));
  if (files.length === 0) return;
  const known = promptUserEntryId();
  const pending = `turn:pending-${promptTurnStart}`;
  const key = known ? `turn:${known}` : pending;
  if (messagesElement?.querySelector(`[data-review-key="${CSS.escape(key)}"]`)) return;
  mountReviewCard(messagesElement, { files, userEntryId: known, key, pendingKey: pending }, t);
  if (!known) void rekeyTurnReviewCard(files, pending);
}

/**
 * @param {{ path: string, add: number, del: number }[]} files
 * @param {string} pending
 */
async function rekeyTurnReviewCard(files, pending) {
  const id = await readSettledTurnId();
  if (!id || pending !== `turn:pending-${promptTurnStart}`) return;
  const key = `turn:${id}`;
  const placed = messagesElement?.querySelector(`[data-review-key="${CSS.escape(key)}"]`);
  if (placed) {
    const stale = messagesElement?.querySelector(`[data-review-key="${CSS.escape(pending)}"]`);
    stale?.closest(".turn-block-files")?.remove();
    return;
  }
  mountReviewCard(messagesElement, { files, userEntryId: id, key, pendingKey: pending }, t);
}

async function readSettledTurnId() {
  const load = () =>
    control.shadowHistoryFiles(target.workspaceId || "", target.sessionId || "", "turn");
  const first = await load().catch(() => null);
  const ready = turnIdOf(first);
  if (ready) return ready;
  await new Promise((resolve) => setTimeout(resolve, 750));
  return turnIdOf(await load().catch(() => null));
}

/**
 * @param {unknown} frame
 */
function turnIdOf(frame) {
  const id = /** @type {{ turn?: { userEntryId?: string } }} */ (frame)?.turn?.userEntryId;
  return typeof id === "string" ? id : "";
}

handleRuntimeEvent.start(
  createRuntimeEventHandler(
    /** @type {Parameters<typeof createRuntimeEventHandler>[0]} */ (
      /** @type {unknown} */ ({
        sessionRuntime: bootstrap,
        metricsOverlay,
        workbench,
        assistantMessageStream,
        setStatus,
        contextUsage,
        getSidebar: () => sidebar,
        getTarget: () => target,
        setLastShownProviderError: (/** @type {unknown} */ value) => {
          lastShownProviderError = /** @type {string | null} */ (value);
        },
        setTurnWrittenPaths: () => {
          promptTurnStart = bootstrap.getState()?.transcript?.turns?.length ?? 0;
        },
        settleForegroundAgent,
        getPendingForkSwitchCheck: () => pendingForkSwitchCheck,
        setPendingForkSwitchCheck: (/** @type {unknown} */ value) => {
          pendingForkSwitchCheck = /** @type {typeof target | null} */ (value);
        },
        checkAndAdoptForkedSession,
        compactCoordinator,
        showError,
        sessionStatus,
        messagesElement,
        t,
        hydrateSnapshotOnce,
        hydrateHeaderSessionStats,
        messageRenderer,
        setLastUserElement: (/** @type {unknown} */ value) => {
          lastUserElement = /** @type {HTMLElement | null} */ (value);
        },
        getLastUserElement: () => lastUserElement,
        upsertActiveSessionFromUserMessage,
        showLiveProcessIndicator,
        liveTurn: {
          host: streamHost,
          release: releaseAnswer,
          adopt: adoptStreamingMessage,
          fold: foldStepIntoLiveTurn,
          step: setLiveStep,
        },
        getStreaming: () => ({ startedAt: streamingStartedAt, element: streamingElement }),
        setStreaming: (/** @type {unknown} */ startedAt, /** @type {unknown} */ element) => {
          streamingStartedAt = /** @type {number | null} */ (startedAt);
          streamingElement = /** @type {HTMLElement | null} */ (element);
        },
        getCurrentModelContextWindow: () => composerModel.contextWindow,
        getCurrentModelId: () => composerModel.modelId,
        getCurrentModelProvider: () => composerModel.provider,
        setSessionCost,
        getSessionTotalCost: () => sessionCostBar.sessionTotalCost,
        headerStatusBar,
        convNav,
        showProviderErrorIfNeeded,
        getInfoSidebar: () => infoSidebar,
        refreshInfoPanel,
        runtime,
        randomId,
        toolRenderer,
        filePreviewFollow,
        textFromResult,
        todoMirrorPanel,
        extensionUi,
        adoptTarget,
        updateComposerThinking,
      })
    ),
  ),
);

/** @param {{ content?: unknown } | null | undefined} [message] */
function upsertActiveSessionFromUserMessage(message = null) {
  const firstMessage = message
    ? textFromMessageContent(
        /** @type {string | { type?: string, text?: string }[] | null | undefined} */ (
          message.content
        ),
      )
    : pendingBoundSessionFirstMessage;
  if (target?.sessionId?.startsWith("temporary-")) {
    pendingBoundSessionFirstMessage =
      typeof firstMessage === "string"
        ? firstMessage
        : firstMessage == null
          ? null
          : String(firstMessage);
    return;
  }
  if (!target?.sessionId) return;
  sidebar?.upsertSession?.({
    id: target.sessionId,
    firstMessage: typeof firstMessage === "string" ? firstMessage : null,
    timestamp: new Date().toISOString(),
    modifiedAtMs: Date.now(),
    isCurrentWorkspace: true,
  });
  pendingBoundSessionFirstMessage = null;
}

function applyActiveSearchHighlight({ scrollToFirst = true } = {}) {
  const query = activeSearchQuery.trim();
  if (!query) {
    messageRenderer.clearSearchHighlights();
    return 0;
  }
  return messageRenderer.highlightSearchQuery(query, { scrollToFirst });
}

/** @param {unknown} result */
function textFromResult(result) {
  const record =
    result && typeof result === "object" ? /** @type {{ content?: unknown }} */ (result) : {};
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .filter(
      (/** @type {unknown} */ part) =>
        part && typeof part === "object" && /** @type {{ type?: string }} */ (part).type === "text",
    )
    .map((/** @type {unknown} */ part) => /** @type {{ text?: string }} */ (part).text ?? "")
    .join("\n");
}

/** @param {unknown} [item] */
function cancelQueueItem(item) {
  cancelQueuedMessage(
    /** @type {Parameters<typeof cancelQueuedMessage>[0]} */ (
      /** @type {unknown} */ ({ runtime, target, item, randomId })
    ),
  ).catch(showError);
}

function abortCurrentRun() {
  void stopRun(
    /** @type {Parameters<typeof stopRun>[0]} */ (
      /** @type {unknown} */ ({
        runtime,
        target,
        onQueueCleared: (/** @type {string} */ text) => {
          if (!input) return;
          if (!input.value.trim()) input.value = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        },
      })
    ),
  ).catch(showError);
  extensionUi.cancelForeground();
}

/** @param {unknown} [event] */
function settleForegroundAgent(event) {
  setStatus("connected");
  contextUsage.setWorking(false);
  sidebar?.setStreaming?.(target.sessionId, false);
  finishLiveTurn({ markDone: true });
  // Changes dock is fed by git status; refresh once per settled turn on repos.
  if (gitPanel?.panel && !gitPanel.panel.notGitRepo) void gitPanel.panel.refresh();
  files.hooks.onSettled();
  mountTurnReviewCard();
  showProviderErrorIfNeeded(event);
  modelConfigRefresh.onSettled();
}

/** @param {unknown} [event] */
function showProviderErrorIfNeeded(event) {
  const error = extractRuntimeEventError(
    /** @type {Parameters<typeof extractRuntimeEventError>[0]} */ (event),
    { fallback: t("messages.providerError") },
  );
  if (!error || error === lastShownProviderError) return;
  lastShownProviderError = error;
  messageRenderer.renderError(error);
}

/** @param {unknown} error */
function showError(error) {
  setStatus("disconnected");
  messageRenderer.renderError(describeHostError(error));
}

// Panel-scoped failures render in chat; only transport errors may flip the status pill.
/** @param {unknown} error */
function showNonFatalError(error) {
  messageRenderer.renderError(describeHostError(error));
}

onLocaleChange(() => {
  renderStatus();
});
const spopiWindow = /** @type {SpopiWindow} */ (window);
spopiWindow.spopi = Object.freeze({
  ...(spopiWindow.spopi || {}),
  debug: {
    runtime,
    data,
    adapter,
    get target() {
      return target;
    },
  },
});

// The overlay's user.js waits for this before it touches the mounted DOM.
window.dispatchEvent(new Event("spopi:ready"));
