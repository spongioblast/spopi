// ABOUTME: Native session composition root: Pi RPC, workbench, preview, git, and chat.
// ABOUTME: SPOPI contracts (packages, PTY, scrape, tree) bind here; Pi stays the only harness.

import { dropContext, pinContext } from "./chat/context-pins.js";
import { createManualCompaction } from "./chat/manual-compaction.js";
import { mountChatFileActions } from "./chat/mount-chat-file-actions.js";
import { mountHistory } from "./chat/mount-history.js";
import { onNextSettled } from "./chat/on-next-settled.js";
import { RpivTodoMirrorPanel } from "./chat/rpiv-todo-mirror.js";
import { createDeferredRuntimeHandler, createRuntimeEventHandler } from "./chat/runtime-events.js";
import { createForegroundSettle } from "./chat/settle-foreground.js";
import { cancelQueuedMessage, stopRun } from "./chat/stop-run.js";
import { paintExtensionNotice } from "./chat/turn-block.js";
import { createUndoMarker } from "./chat/undo-marker.js";
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
import { createSendModelGate } from "./composer/send-model-gate.js";
import { buildCommandCatalog } from "./composer/slash-commands.js";
import { mountCenterRepaint } from "./editor/center-paint.js";
import { createFilePreviewFollow } from "./editor/file-preview-follow.js";
import { mountFilePreview } from "./editor/mount-file-preview.js";
import { connectReviewPane } from "./editor/review/connect-review-pane.js";
import { mountReviewPane } from "./editor/review-pane.js";
import { CustomUiPanel } from "./extension-ui/custom-ui-panel.js";
import { ExtensionCommandCompatibility } from "./extension-ui/extension-command-compatibility.js";
import { createExtensionUiHooks } from "./extension-ui/extension-ui-hooks.js";
import { ExtensionUiHost } from "./extension-ui/extension-ui-host.js";
import { ExtensionWidgets } from "./extension-ui/extension-widgets.js";
import { showInlineExtensionPrompt } from "./extension-ui/inline-extension-prompt.js";
import { connectFileTree, mountSidebarToggle } from "./files/mount-file-browser.js";
import { mountGitPanel } from "./git/git-panel-integration.js";
import { createI18n, hydrateLanguagePreference, onLocaleChange, t } from "./i18n/i18n.js";
import { createNotificationCenter } from "./notifications/notification-center.js";
import { createSessionTaskNotifications } from "./notifications/task-completion-notifications.js";
import { createAssistantMessageStream } from "./session/assistant-message-stream.js";
import { mountContextUsage } from "./session/context-usage.js";
import { createForkAdopt } from "./session/fork-adopt.js";
import { mountInfoSidebar } from "./session/info-sidebar.js";
import { mountMessageForkHandler } from "./session/message-fork.js";
import { describeHostError } from "./session/missing-workspace.js";
import { mountSessionSidebar } from "./session/mount-session-sidebar.js";
import { showProjectsFolderFallback } from "./session/projects-folder-fallback.js";
import { adoptCreatedSessions } from "./session/session-created-action.js";
import { activeSession, mountSessionInfo } from "./session/session-info.js";
import { textFromMessageContent } from "./session/session-log.js";
import { createSessionSelectionHandler } from "./session/session-navigation.js";
import { createSessionRuntime } from "./session/session-runtime.js";
import { mountSessionSearchDialog } from "./session/session-search-dialog.js";
import { SessionSidebar } from "./session/session-sidebar.js";
import { createSessionStatus } from "./session/session-status.js";
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
import { createSpopiWorkbench } from "./shell/mount-workbench.js";
import { mountOverlayChrome } from "./shell/overlay-chrome.js";
import { mountProjectHeader } from "./shell/project-header.js";
import { mountSessionCostBar } from "./shell/session-cost-bar.js";
import { mountUiReload } from "./shell/ui-reload.js";
import { createUiStoreBinding, hydrateUiStore } from "./storage/ui-store.js";
import { stopCommand } from "./subagents/subagent-feed.js";
import { SubagentStrip } from "./subagents/subagent-strip.js";
import {
  configureSubagentView,
  openSubagent,
  resetSubagentView,
} from "./subagents/subagent-view.js";
import { openPiInTerminal } from "./terminal/open-in-terminal.js";
import { runFileInTerminal } from "./terminal/run-file.js";
import { mountTerminalPanel } from "./terminal/terminal-panel-integration.js";
import { applyTheme, getCurrentTheme, hydrateThemePreference } from "./theme/themes.js";
import { ConfigGateway } from "./transport/config-gateway.js";
import {
  createConfigGatewayConnectionListener,
  signalConfigGatewayReady,
} from "./transport/config-gateway-readiness.js";
import { HostControlGateway } from "./transport/control-gateway.js";
import { HostDataGateway } from "./transport/data-gateway.js";
import { watchHostReconnect } from "./transport/host-reconnect.js";
import { createOauthGateway } from "./transport/oauth-gateway.js";
import { PreferenceGateway } from "./transport/preference-gateway.js";
import { HostRuntimeAdapter, resolveHostWebSocketUrl } from "./transport/runtime-adapter.js";
import { subscribeRuntimeFrames } from "./transport/runtime-frame-routing.js";
import { RuntimeGateway } from "./transport/runtime-gateway.js";
import { buildAtMentionValue, mountAtFileMention } from "./ui/at-file-mention.js";
import { createLongPress } from "./ui/context-menu.js";
import { ConvNav } from "./ui/conv-nav.js";
import { mountMessagesInsets } from "./ui/layout-insets.js";
import { MessageRenderer } from "./ui/message-renderer.js";
import { mountResizablePanel, refreshResizablePanels } from "./ui/resizable-panel.js";
import { ToolCardRenderer } from "./ui/tool-card.js";
import { mountAppKeyboardShortcuts } from "./utils/keyboard-shortcuts.js";
import { randomId, sessionScopedClientId } from "./utils/random-id.js";
import { parseAppRoute, replaceTemporarySessionRoute } from "./utils/router.js";

/**
 * @typedef {import("./shell/app-chrome.js").AppChromeRefs} AppChromeRefs
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
 *   newChatInCurrentProject?: () => void,
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
mountReviewPane();
mountCenterRepaint();
createLongPress();
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
const taskCompletionNotifications = createSessionTaskNotifications({
  getSessions: () => sidebar?.sessions ?? [],
  t,
});

mountMessagesInsets(
  /** @type {Parameters<typeof mountMessagesInsets>[0]} */ (
    /** @type {unknown} */ ({
      main: chrome.layout.main,
      messages: messagesElement,
      header: chrome.chat.header,
      inputArea: chrome.composer.inputArea,
      workspaceContent: chrome.layout.content,
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
const todoMirrorPanel = new RpivTodoMirrorPanel({ container: chrome.composer.inputArea });
// pi-subagents' commands run inline over RPC without a model turn, so they go as prompts.
/** @param {string} command */
const runSubagentCommand = (command) =>
  runtime.request({ type: "prompt", message: command }, target, { idempotencyKey: randomId() });
configureSubagentView({ run: runSubagentCommand, t });
const subagentStrip = new SubagentStrip({
  container: chrome.composer.inputArea,
  t,
  onOpen: openSubagent,
  onStop: (runId, childId) => void runSubagentCommand(stopCommand(runId, childId)),
});
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
  layout: chrome.layout,
  toolbar: chrome.chat.headerRight,
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
// The workbench calls config while it mounts (cache warming, thinking budgets), so config comes first.
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
/** @type {ReturnType<typeof mountSettingsPanel> | undefined} */
let settingsPanel;
// The shell can report a restored panel while it mounts, before Files and Git exist.
let workspacePanelsMounted = false;
/** @type {((anchor: Element) => void) | null} */
let continueLiveTurn = null;
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
        dropContext(item, (entryId) => config.call("drop_context", { entryId }), messagesElement),
      getWorkspaceId: () => target.workspaceId,
      chrome: {
        layout: chrome.layout,
        inputArea: chrome.composer.inputArea,
        headerRight: chrome.chat.headerRight,
        status: chrome.chat.status,
        terminal: terminalIntegration?.panel?.root ?? null,
      },
      sendPrompt: (/** @type {string} */ message) =>
        runtime.request({ type: "prompt", message }, target, { idempotencyKey: randomId() }),
      getPackages: () => piPackages,
      installPackage: async (/** @type {string} */ source) => {
        await control.installPiPackage(source);
        await refreshPiPackages();
      },
      onOpenSettings: (/** @type {string | undefined} */ page) => {
        if (settingsPanel) {
          settingsPanel.openSettings(page || "general");
          return true;
        }
        chrome.sidebar.settingsBtn?.click();
      },
      onOpenFile: (/** @type {string} */ path, /** @type {number | undefined} */ line) =>
        filePreviewPanel?.openFile?.(path, { line }),
      onNavigateTree: (/** @type {unknown} */ payload) => {
        const id =
          typeof payload === "string"
            ? payload
            : /** @type {{ targetId?: string }} */ (payload)?.targetId;
        if (typeof id === "string") navigateActiveTree(id);
      },
      onPanelShown: showWorkspacePanel,
      onDockTabChange: (/** @type {string} */ id) => {
        if (id === "terminal") void terminalIntegration?.panel?.expand();
      },
      openInTerminal: () =>
        openPiInTerminal(
          /** @type {Parameters<typeof openPiInTerminal>[0]} */ (
            /** @type {unknown} */ ({
              client: terminalIntegration?.client,
              panel: terminalIntegration?.panel,
              workbench,
              notify: notifications.notify,
            })
          ),
        ),
      onRunFile: runFile,
      configCall: (
        /** @type {string} */ op,
        /** @type {Record<string, unknown> | undefined} */ params,
        /** @type {{ timeoutMs?: number, target?: import("./transport/config-gateway.js").ConfigTarget | null } | undefined} */ options,
      ) => config.call(op, params || {}, options),
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
      mainContainer: chrome.layout.main,
      getWorkspaceId: () => target.workspaceId,
      data,
      control,
      showError,
      onToggleChat: (/** @type {boolean} */ hidden) =>
        workbench.shell?.applyHidden?.({ chatHidden: Boolean(hidden) }),
    })
  ),
);
const getWorkspacePath = async () => {
  try {
    const response = await data.workspaceInfo(target.workspaceId || "");
    const frame = /** @type {{ info?: { path?: string }, path?: string }} */ (response);
    return frame?.info?.path ?? frame?.path ?? "";
  } catch {
    return "";
  }
};
const filePreviewFollow = createFilePreviewFollow(
  /** @type {Parameters<typeof createFilePreviewFollow>[0]} */ (
    /** @type {unknown} */ ({
      panel: filePreviewPanel,
      getWorkspacePath,
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
      getProjectPath: getWorkspacePath,
      identity: {
        load: () => control.getGitIdentity(target.workspaceId || ""),
        save: (
          /** @type {{ name: string, email: string, scope: "global" | "repository" }} */ draft,
        ) =>
          control.setGitIdentity({
            workspaceId: target.workspaceId || "",
            name: draft.name,
            email: draft.email,
            scope: draft.scope,
          }),
      },
      onRepositoryFound: () => {
        void mountProjectHeader({ data, workspaceId: target.workspaceId });
        void sidebar?.load?.({ quiet: true })?.catch(showError);
      },
    })
  ),
);
connectReviewPane({
  control,
  runtime,
  getTarget: () => target,
  getGitPanel: () => gitPanel,
  getProjectPath: getWorkspacePath,
  isWorking: () => bootstrap.isWorking(),
  hasCommand: (name) => [...commandCatalog.values()].some((command) => command?.name === name),
  listCommands: () => [...commandCatalog.values()],
  randomId,
  t,
});

// ── Info panel (session tree + workspace actions) ─────────────────────
const infoSidebarState = mountInfoSidebar(
  /** @type {Parameters<typeof mountInfoSidebar>[0]} */ (
    /** @type {unknown} */ ({
      infoSidebar: chrome.sidePanels.info,
      panel: chrome.sidePanels.infoPanel,
      messages: messagesElement,
      infoClose: chrome.sidePanels.infoClose,
      infoRefresh: chrome.sidePanels.infoRefresh,
      infoSidebarToggle: chrome.chat.infoSidebarToggle,
      fileSidebar: chrome.fileSidebar.sidebar,
      t,
      data,
      runtime,
      getTarget: () => target,
      isWorking: () => bootstrap.isWorking(),
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
      onRunFile: runFile,
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

/** @param {string} id */
function showWorkspacePanel(id) {
  if (!workspacePanelsMounted) return;
  // Leaving Git gives the file sidebar its tree and header buttons back.
  if (id !== "git" && gitPanel?.getTab?.() === "git") gitPanel.setTab?.("files");
  files.hooks.onPanelShown(id);
  if (id === "git") {
    gitPanel?.setTab?.("git");
    /** @type {{ refresh?: () => void }} */ (gitPanel)?.refresh?.();
  }
}

/** @param {string} path */
function runFile(path) {
  return runFileInTerminal(
    /** @type {Parameters<typeof runFileInTerminal>[0]} */ ({
      client: terminalIntegration?.client,
      panel: terminalIntegration?.panel,
      workbench,
      path,
    }),
  );
}

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

const sessionCostBar = mountSessionCostBar(
  /** @type {Parameters<typeof mountSessionCostBar>[0]} */ (
    /** @type {unknown} */ ({
      sessionCostEl: chrome.chat.sessionCost,
      t,
      onTotalsChange: (/** @type {{ input?: number, output?: number }} */ totals) =>
        contextUsage.setSessionTotals(totals),
      runtime,
      getTarget: () => target,
      getSessions: () => sidebar?.sessions ?? [],
    })
  ),
);
const { headerStatusBar, hydrateHeaderSessionStats } = sessionCostBar;

const manualCompaction = createManualCompaction({
  runtime,
  getTarget: () => target,
  contextUsage,
  getStatus: () => bootstrap.getState().status,
  randomId,
});
const compactCoordinator = manualCompaction.coordinator;
compactContextButton?.addEventListener("click", () => manualCompaction.request().catch(showError));
const extensionUi = new ExtensionUiHost({
  runtime,
  showDialog: (request, opts) => showNativeDialog(request, undefined, opts),
  showInlinePrompt: (request, opts) =>
    showInlineExtensionPrompt(request, {
      container: messagesElement,
      onAnswered: (card) => continueLiveTurn?.(card),
      ...opts,
    }),
  hooks: createExtensionUiHooks({
    config,
    customUiPanel,
    openCustomUiTab: () =>
      workbench.center?.openCustomTab?.("custom-ui", t("chat.customUiTab"), customUiHost),
    commandCompatibility,
    todoMirrorPanel,
    undoMarker,
    subagentStrip,
    extensionWidgets,
    input,
    composerAutoResize,
    messagesElement,
    getSessionId: () => target.sessionId,
    hydrateSnapshot: () => hydrateSnapshotOnce(),
    showError,
  }),
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
  /** @type {(snapshot: { messages: import("./chat/transcript-reducer.js").TranscriptMessage[], sequence?: number, streaming?: boolean }) => void} */
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
      todoMirrorPanel,
      convNav,
      setStatus,
      refreshPiPackages,
      contextUsage,
      composerModel,
      runtime,
      cancelQueueItem,
      hydrateHeaderSessionStats,
      late: historyLate,
    })
  ),
);
continueLiveTurn = continueLiveTurnBelow;

document.addEventListener("spopi-notice", (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  if (detail && typeof detail.message === "string") paintExtensionNotice(messagesElement, detail);
});

subscribeRuntimeFrames({
  runtime,
  config,
  getTarget: () => /** @type {{ instanceId: string, sessionId?: string }} */ (target),
  getSessionRuntime: () => bootstrap,
  consumeOauthFrame: (frame) =>
    oauthGateway.consumeFrame(
      /** @type {Parameters<typeof oauthGateway.consumeFrame>[0]} */ (frame),
    ),
  onTaskFrame: taskCompletionNotifications.handleRuntimeFrame,
  onForegroundEvent: handleRuntimeEvent,
  onBackgroundFrame: (frame) =>
    handleBackgroundRuntimeEvent(
      /** @type {Parameters<typeof handleBackgroundRuntimeEvent>[0]} */ (frame),
    ),
  hydrateSnapshot: () => hydrateSnapshotOnce(),
  showError,
});
createConfigGatewayConnectionListener({
  adapter,
  isReady: () => configGatewayTargetReady,
  onDisconnected: () => setStatus("disconnected"),
});
watchHostReconnect({ setStatus });
adapter.connect();

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
      updateComposerModel,
      updateComposerThinking,
      syncComposerWithPi: composerPiSync.sync,
      refreshInfoPanel,
      mountProjectHeader,
      loadAvailableModels,
      spawnSessionViaHost,
      openSessionInProjectViaHost,
      buildCommandCatalog,
      commandCompatibility,
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
historyLate.dispatchSnapshot = (snapshot) => {
  bootstrap.dispatch({ type: "snapshot", ...snapshot });
};
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
mountAppSidebarToggle();
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
      throw new Error(result?.error || t("composer.pasteOffloadFailed"));
    }
    return result.data.path;
  },
  t,
});
abortButton?.addEventListener("click", abortCurrentRun);
const forkAdopt = createForkAdopt({
  runtime,
  getTarget: () => /** @type {import("./transport/runtime-gateway.js").RuntimeTarget} */ (target),
  getSidebar: () => sidebar,
  adoptTarget,
  hydrateSnapshot: hydrateSnapshotOnce,
  showError,
});
mountChatFileActions(
  /** @type {Parameters<typeof mountChatFileActions>[0]} */ (
    /** @type {unknown} */ ({
      runtime: bootstrap,
      messagesElement,
      filePreviewFollow,
      terminalIntegration,
      showError,
    })
  ),
);
mountMessageForkHandler(
  /** @type {Parameters<typeof mountMessageForkHandler>[0]} */ (
    /** @type {unknown} */ ({
      messagesElement,
      isWorking: () => bootstrap.isWorking(),
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
      adoptForkedSession: forkAdopt.adopt,
      navigateTree: navigateActiveTree,
      input,
      composerAutoResize,
    })
  ),
);

chrome.sidebar.refreshSessionsBtn?.addEventListener("click", (e) => {
  const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
  btn.classList.remove("spinning");
  // Force reflow so re-adding the class restarts the animation
  void btn.offsetWidth;
  btn.classList.add("spinning");
  void sidebar?.load?.()?.catch(showError);
});
files.setup();
workspacePanelsMounted = true;
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
      isWorking: () => bootstrap.isWorking(),
      getTarget: () => target,
      getCommandCatalog: () => commandCatalog,
      clearPendingFork: () => forkAdopt.setPending(null),
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
document.addEventListener("spopi-dismiss-mcp-sign-in", (event) => {
  const prefix = `Waiting for sign-in to "${/** @type {CustomEvent} */ (event).detail?.name}"`;
  extensionUi.cancelForegroundWhere(
    (request) => request.method === "input" && String(request.title ?? "").startsWith(prefix),
  );
});
document.addEventListener("spopi-pi-config-changed", () => {
  void config
    .call("mcp_config_changed")
    .then((result) => {
      if (result?.data && /** @type {{ reloaded?: boolean }} */ (result.data).reloaded === false) {
        onNextSettled(() => {
          void config.call("mcp_config_changed").catch(() => {});
        });
      }
    })
    .catch(() => {});
});
settingsPanel = mountSettingsPanel(
  /** @type {Parameters<typeof mountSettingsPanel>[0]} */ (
    /** @type {unknown} */ ({
      data,
      control,
      preferences,
      terminal: terminalIntegration,
      workbench,
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
/** @param {string | undefined} tab */
const openSettingsTab = (tab) => settingsPanel?.openSettings(tab || "general");
void maybeShowFirstRun({ preferences, control, openSettings: openSettingsTab });
document.addEventListener("spopi-show-first-run", () => {
  settingsPanel?.closeSettings({ clearHash: true });
  void maybeShowFirstRun({ preferences, control, openSettings: openSettingsTab, force: true });
});
mountAppUpdater();
mountNewSessionButton({ control, onError: showError });

adoptCreatedSessions({
  getWorkspaceId: () => target.workspaceId,
  clearChat: () => {
    messageRenderer.clear();
    toolRenderer.clear();
  },
  adoptTarget,
  input,
  composerAutoResize,
  hydrateSnapshot: () => hydrateSnapshotOnce(),
  showError,
});

mountOpenFolderButton({ onError: showError });
mountAppKeyboardShortcuts({
  input,
  abort: abortCurrentRun,
  isWorking: () => bootstrap.isWorking(),
  newChat: () => sidebar?.newChatInCurrentProject?.(),
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

function mountAppSidebarToggle() {
  mountSidebarToggle({
    mountResizablePanel:
      /** @type {Parameters<typeof mountSidebarToggle>[0]["mountResizablePanel"]} */ (
        /** @type {unknown} */ (mountResizablePanel)
      ),
    sidebarEl: chrome.sidebar.sidebar,
    toggleBtn: chrome.chat.sidebarToggle,
    overlay: chrome.sidebar.overlay,
    fileSidebarEl: chrome.fileSidebar.sidebar,
  });
}

const foregroundSettle = createForegroundSettle({
  setStatus,
  contextUsage,
  getSidebar: () => sidebar,
  getTarget: () => target,
  getTurns: () => bootstrap.getState()?.transcript?.turns || [],
  finishLiveTurn,
  gitPanel,
  files,
  modelConfigRefresh,
  control,
  messageRenderer,
  messagesElement,
  t,
});

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
        setLastShownProviderError: foregroundSettle.setLastShownProviderError,
        setTurnWrittenPaths: foregroundSettle.markTurnStart,
        settleForegroundAgent: foregroundSettle.settle,
        getPendingForkSwitchCheck: forkAdopt.getPending,
        setPendingForkSwitchCheck: forkAdopt.setPending,
        checkAndAdoptForkedSession: forkAdopt.adopt,
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
        convNav,
        showProviderErrorIfNeeded: foregroundSettle.showProviderErrorIfNeeded,
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
