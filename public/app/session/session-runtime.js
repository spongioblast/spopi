// ABOUTME: One session runtime per window: transcript state plus start and switch.
// ABOUTME: RPC commands and snapshot hydration go through this store.

import { watchTranscript } from "../chat/history-render.js";
import { emptyTranscriptState, reduceSession } from "../chat/transcript-reducer.js";
import { renderQueuedMessages } from "../composer/queued-messages.js";
import { paintSessionChrome } from "../composer/session-chrome.js";
import { uiStore } from "../storage/ui-store.js";
import { resolveBootstrapTarget } from "../transport/bootstrap-target.js";
import {
  clearMissingWorkspace,
  rememberHiddenLocal,
  showMissingWorkspace,
} from "./missing-workspace.js";
import { summarizeMessageRoles } from "./session-log.js";
import { switchSessionTo } from "./switch-session.js";
import { handOffProjectOnLeave, takeLeftProject } from "./window-project.js";

/**
 * @typedef {{ workspaceId: string, sessionId: string, instanceId?: string }} SessionTarget
 *
 * @typedef {{ workspaceId: string, sessionId: string, name?: string }} SessionRoute
 *
 * @typedef {import("../chat/transcript-reducer.js").SessionAction} SessionRuntimeAction
 *
 * @typedef {(next: ReturnType<typeof emptyTranscriptState>, action: SessionRuntimeAction) => void} SessionRuntimeSubscriber
 *
 * @typedef {{
 *   setActive: (sessionId: string) => void,
 *   load: (opts?: { quiet?: boolean }) => Promise<unknown>,
 *   setStreaming: (sessionId: string | undefined, streaming: boolean) => void,
 *   markUnread: (sessionId: string | undefined) => void,
 *   setSessionName: (sessionId: string | undefined, name: unknown) => void,
 *   render?: () => void,
 * }} SessionSidebarLike
 *
 * @typedef {{
 *   target: SessionTarget,
 *   snapshotInFlight: boolean,
 *   commandCatalog: unknown,
 *   diskHistoryFallback: { sessionId: string, messages: unknown[] } | null,
 *   navigationGeneration: number,
 *   configGatewayTargetReady: boolean,
 *   infoTreeSeq: number,
 *   streamingElement: unknown,
 *   streamingStartedAt: number | null,
 *   liveProcessGroup: unknown,
 *   sidebar: SessionSidebarLike | null | undefined,
 *   slashMenu: { update: () => void },
 *   headerStatusBar?: { reset?: () => void },
 *   infoSidebar?: { classList: { contains: (name: string) => boolean } } | null,
 *   runtime: {
 *     request: (cmd: Record<string, unknown>, target: SessionTarget | unknown) => Promise<{
 *       response?: { data?: { commands?: unknown[] } },
 *     }> | unknown,
 *     snapshot: (sessionId: string) => Promise<unknown>,
 *   },
 *   adapter: {
 *     ready: () => Promise<void> | void,
 *     subscribeTarget: (target: SessionTarget) => void,
 *   },
 *   data: {
 *     readSessionMessages: (
 *       workspaceId: string,
 *       sessionId: string,
 *     ) => Promise<{ messages?: unknown[] } | null | undefined>,
 *     workspaceInfo?: (workspaceId: string) => Promise<{ info?: { path?: string } } | null | undefined>,
 *   },
 *   history: History,
 *   convNav: { rebuild: () => void },
 *   extensionUi: {
 *     setForegroundSession: (sessionId: string, opts?: { flush?: boolean }) => Promise<void> | void,
 *     flushForegroundQueue: () => Promise<void> | void,
 *   },
 *   input: { focus: () => void },
 *   composerAutoResize: { sync: () => void },
 *   queuedMessages: HTMLElement | null | undefined,
 *   todoMirrorPanel: { clear: () => void },
 *   extensionWidgets: { clear: () => void },
 *   customUiPanel: { close: (opts?: { notifyExtension?: boolean }) => void },
 *   filePreviewFollow: { clear: () => void },
 *   assistantMessageStream: { reset: () => void },
 *   files: { hooks: { onWorkspaceChange: (workspaceId: string) => unknown } },
 *   config: { call: (op: string, params?: unknown) => unknown },
 *   control: { sweepProject?: (path: string) => Promise<unknown> },
 *   sessionUiState: {
 *     loadProfile: () => Promise<{ provider?: string, modelId?: string, thinkingLevel?: unknown } | null | undefined>,
 *   },
 *   infoPanel?: { updateTree: (tree: { entries: unknown[], leafId: null }) => void },
 *   route: SessionRoute,
 *   setStatus: (status: string) => void,
 *   showError: (error: unknown) => void,
 *   renderHistory?: (messages: unknown[]) => unknown,
 *   hydrateFromSnapshot: (snapshot: unknown) => Promise<void> | void,
 *   resolveConfigGatewayReady: () => void,
 *   signalConfigGatewayReady: () => void,
 *   cancelQueueItem: (item?: unknown) => void,
 *   syncSessionInfo: () => void,
 *   hydrateHeaderSessionStats: () => void,
 *   updateComposerModel: (model: { provider?: string, id?: string }) => void,
 *   updateComposerThinking: (level: unknown) => void,
 *   syncComposerWithPi: (options: { piModel?: unknown, inheritLastModel?: boolean }) => Promise<void> | void,
 *   refreshInfoPanel: (opts?: { refreshWorkspace?: boolean }) => unknown,
 *   mountProjectHeader: (opts: { data: unknown, workspaceId: string }) => Promise<unknown>,
 *   loadAvailableModels: () => Promise<unknown>,
 *   spawnSessionViaHost: (workspaceId?: string) => Promise<unknown>,
 *   openSessionInProjectViaHost: (session: unknown) => Promise<void> | void,
 *   buildCommandCatalog: (opts: { commands: unknown[] }) => unknown,
 *   commandCompatibility: { prune: (values: unknown) => void },
 *   activeSearchQuery?: string,
 *   mountSessionSidebar: (opts: Record<string, unknown>) => SessionSidebarLike | null | undefined,
 *   createSessionSelectionHandler: unknown,
 *   SessionSidebar: unknown,
 *   mountSessionSearchDialog: unknown,
 *   createSessionViaHost: unknown,
 *   applyActiveSearchHighlight: unknown,
 *   replaceTemporarySessionRoute: (
 *     history: History,
 *     workspaceId: string,
 *     fromSessionId: string,
 *     toSessionId: string,
 *   ) => void,
 * }} SessionRuntimeDeps
 *
 * Session start and switch. `deps` is read when a call runs, after app.js has
 * finished initializing.
 * @param {SessionRuntimeDeps} deps
 */
export function createSessionRuntime(deps) {
  let state = emptyTranscriptState();
  /** @type {Set<SessionRuntimeSubscriber>} */
  const subscribers = new Set();
  let lastHistoryResult = false;

  function getState() {
    return state;
  }

  /**
   * @param {SessionRuntimeSubscriber} fn
   */
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  /**
   * @param {SessionRuntimeAction} action
   */
  function dispatch(action) {
    const previous = state;
    state = reduceSession(state, action, deps.target);
    // A frame only advances the sequence; nothing on screen depends on it.
    if (action?.type === "frame") return state;
    if (previous.queue !== state.queue) {
      renderQueuedMessages(deps.queuedMessages, state.queue, { onCancel: deps.cancelQueueItem });
    }
    paintSessionChrome(state);
    for (const fn of subscribers) fn(state, action);
    return state;
  }

  function isWorking() {
    return state.status.running;
  }

  function targetOf() {
    return deps.target;
  }

  const commands = {
    /**
     * @param {unknown} message
     */
    prompt(message) {
      return deps.runtime.request({ type: "prompt", message }, targetOf());
    },
    abort() {
      return deps.runtime.request({ type: "abort" }, targetOf());
    },
    /**
     * @param {unknown} model
     */
    setModel(model) {
      return deps.runtime.request({ type: "set_model", model }, targetOf());
    },
    cycleThinking() {
      return deps.runtime.request({ type: "cycle_thinking_level" }, targetOf());
    },
    compact() {
      return deps.runtime.request({ type: "compact" }, targetOf());
    },
    /**
     * @param {unknown} entryId
     */
    fork(entryId) {
      return deps.runtime.request({ type: "fork", entryId }, targetOf());
    },
  };

  /**
   * @param {import("../chat/transcript-reducer.js").TranscriptMessage[]} messages
   */
  function renderThroughStore(messages) {
    dispatch({ type: "snapshot", messages });
    return lastHistoryResult;
  }

  if (typeof deps.renderHistory === "function") {
    watchTranscript(
      {
        subscribe,
        get lastHistoryResult() {
          return lastHistoryResult;
        },
        set lastHistoryResult(value) {
          lastHistoryResult = value;
        },
      },
      deps.renderHistory,
    );
  }

  /**
   * @param {{ workspaceId?: string, sessionId?: string }} currentRoute
   * @returns {Promise<unknown>}
   */
  async function requestBootstrapTarget(currentRoute) {
    const query = new URLSearchParams({
      workspaceId: /** @type {string} */ (currentRoute.workspaceId),
      sessionId: /** @type {string} */ (currentRoute.sessionId),
    });
    const response = await fetch(`/v2/bootstrap?${query}`);
    if (!response.ok) {
      /** @type {Error & { status?: number, code?: string }} */
      const error = new Error("This SPOPI runtime is stopped or unavailable");
      error.status = response.status;
      const body = /** @type {{ error?: { code?: unknown } } | null} */ (
        await response.json().catch(() => null)
      );
      if (typeof body?.error?.code === "string") error.code = body.error.code;
      throw error;
    }
    return /** @type {Promise<unknown>} */ (response.json());
  }

  /**
   * @param {SessionRoute | { workspaceId?: string, sessionId?: string }} currentRoute
   * @param {{ replaceMissing?: boolean }} [options]
   * @returns {Promise<SessionTarget>}
   */
  async function loadBootstrapTarget(currentRoute, { replaceMissing = false } = {}) {
    return /** @type {Promise<SessionTarget>} */ (
      resolveBootstrapTarget({
        route: currentRoute,
        requestTarget: requestBootstrapTarget,
        spawnTemporarySession: deps.spawnSessionViaHost,
        replaceMissing,
      })
    );
  }

  async function hydrateSnapshot() {
    const expectedSessionId = deps.target.sessionId;
    const snapshot = await deps.runtime.snapshot(expectedSessionId);
    if (deps.target.sessionId !== expectedSessionId) return;
    await deps.hydrateFromSnapshot(snapshot);
    deps.configGatewayTargetReady = true;
    deps.resolveConfigGatewayReady();
    deps.signalConfigGatewayReady();
  }

  /**
   * @param {unknown} error
   */
  function isTransientConnectionError(error) {
    const msg =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String(/** @type {{ message: unknown }} */ (error).message)
          : "";
    return (
      msg.includes("SPOPI Host runtime is disconnected") ||
      msg.includes("Runtime disconnected before the request completed") ||
      msg.includes("Host disconnected before the")
    );
  }

  async function hydrateSnapshotOnce() {
    if (deps.snapshotInFlight) return;
    deps.snapshotInFlight = true;
    try {
      await hydrateSnapshot();
    } catch (error) {
      if (isTransientConnectionError(error)) {
        const message =
          error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? /** @type {{ message: unknown }} */ (error).message
              : error;
        console.warn(
          "[Session] Transient connection error during snapshot; retrying after reconnect:",
          message,
        );
        await deps.adapter.ready();
        await hydrateSnapshot();
      } else {
        throw error;
      }
    } finally {
      deps.snapshotInFlight = false;
    }
  }

  async function loadCommands() {
    const result = /** @type {{ response?: { data?: { commands?: unknown[] } } }} */ (
      await deps.runtime.request({ type: "get_commands" }, deps.target)
    );
    deps.commandCatalog = deps.buildCommandCatalog({
      commands: result.response?.data?.commands ?? [],
    });
    deps.commandCompatibility.prune(
      /** @type {{ values: () => unknown }} */ (deps.commandCatalog).values(),
    );
  }

  /**
   * @param {SessionTarget} nextTarget
   * @param {{ updateRoute?: boolean }} [options]
   */
  async function adoptTarget(nextTarget, { updateRoute = true } = {}) {
    const previousTarget = deps.target;
    const sessionChanged = nextTarget.sessionId !== previousTarget.sessionId;
    const targetChanged =
      sessionChanged ||
      nextTarget.workspaceId !== previousTarget.workspaceId ||
      nextTarget.instanceId !== previousTarget.instanceId;
    if (!targetChanged) return;
    deps.configGatewayTargetReady = false;
    if (updateRoute && sessionChanged) {
      deps.replaceTemporarySessionRoute(
        deps.history,
        previousTarget.workspaceId,
        previousTarget.sessionId,
        nextTarget.sessionId,
      );
    }
    deps.target = nextTarget;
    if (sessionChanged) document.dispatchEvent(new CustomEvent("spopi-session-opened"));
    dispatch({ type: "reset" });
    deps.snapshotInFlight = false;
    deps.todoMirrorPanel.clear();
    deps.extensionWidgets.clear();
    deps.customUiPanel.close({ notifyExtension: false });
    deps.filePreviewFollow.clear();
    deps.assistantMessageStream.reset();
    deps.streamingElement = null;
    deps.streamingStartedAt = null;
    deps.liveProcessGroup = null;
    deps.adapter.subscribeTarget(deps.target);
    deps.sidebar?.setActive(deps.target.sessionId);
    if (nextTarget.workspaceId !== previousTarget.workspaceId) {
      void sweepLeftProject(deps, previousTarget.workspaceId);
      void deps.files.hooks.onWorkspaceChange(nextTarget.workspaceId);
      deps.sidebar?.load().catch(deps.showError);
      deps
        .mountProjectHeader({
          data: deps.data,
          workspaceId: nextTarget.workspaceId,
        })
        .catch(
          /** @param {unknown} error */ (error) => {
            console.warn("[spopi] Failed to load project header info:", error);
          },
        );
    }
    deps.infoTreeSeq += 1;
    deps.infoPanel?.updateTree({ entries: [], leafId: null });
    if (deps.infoSidebar && !deps.infoSidebar.classList.contains("collapsed")) {
      void deps.refreshInfoPanel({
        refreshWorkspace: nextTarget.workspaceId !== previousTarget.workspaceId,
      });
    }
    deps.syncSessionInfo();
    deps.headerStatusBar?.reset?.();
    deps.hydrateHeaderSessionStats();
    const restoredProfile = await deps.sessionUiState.loadProfile();
    if (restoredProfile) {
      deps.updateComposerModel({ provider: restoredProfile.provider, id: restoredProfile.modelId });
      deps.updateComposerThinking(restoredProfile.thinkingLevel);
    }
    void deps.syncComposerWithPi({});
    deps.composerAutoResize.sync();
    await deps.extensionUi.setForegroundSession(deps.target.sessionId, { flush: false });
  }

  /**
   * @param {string} sessionId
   */
  async function switchSession(sessionId) {
    return switchSessionTo(
      sessionId,
      /** @type {import("./switch-session.js").SwitchSessionContext} */ ({
        getTarget: () => deps.target,
        nextGeneration: () => {
          deps.navigationGeneration += 1;
          return deps.navigationGeneration;
        },
        getGeneration: () => deps.navigationGeneration,
        setStatus: deps.setStatus,
        loadBootstrapTarget,
        setDiskHistoryFallback: () => {
          deps.diskHistoryFallback = null;
        },
        renderHistory: renderThroughStore,
        convNav: deps.convNav,
        adoptTarget,
        history: deps.history,
        getSidebar: () => deps.sidebar,
        extensionUi: deps.extensionUi,
        runtime: deps.runtime,
        hydrateFromSnapshot: deps.hydrateFromSnapshot,
      }),
    );
  }

  /**
   * @param {{ projectPath?: string, id?: string }} session
   */
  async function openSessionInProject(session) {
    const invoke =
      /** @type {{ __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }} */ (
        globalThis
      ).__TAURI__?.core?.invoke;
    if (!invoke) {
      await deps.openSessionInProjectViaHost(session);
      return;
    }
    await invoke("open_session_in_project", {
      projectPath: session.projectPath,
      sessionId: session.id,
    });
  }

  async function start() {
    try {
      const initialLoadStartedAt = performance.now();
      console.info("[spopi] session load: initial load started", {
        sessionId: deps.route.sessionId,
      });
      const bootstrapStartedAt = performance.now();
      const bootstrappedTarget = await loadBootstrapTarget(deps.route, { replaceMissing: true });
      console.info("[spopi] session load: initial bootstrap completed", {
        sessionId: bootstrappedTarget.sessionId,
        elapsedMs: Math.round(performance.now() - bootstrapStartedAt),
      });
      await adoptTarget(bootstrappedTarget, { updateRoute: false });
      const left = takeLeftProject();
      if (left && left !== bootstrappedTarget.workspaceId) void sweepLeftProject(deps, left);
      handOffProjectOnLeave(() => deps.target?.workspaceId);
      deps.sidebar?.load({ quiet: true }).catch(deps.showError);
      if (deps.target.sessionId !== deps.route.sessionId) {
        deps.replaceTemporarySessionRoute(
          deps.history,
          deps.route.workspaceId,
          deps.route.sessionId,
          deps.target.sessionId,
        );
      }
      const hostReadyStartedAt = performance.now();
      await deps.adapter.ready();
      console.info("[spopi] session load: initial Host connection ready", {
        elapsedMs: Math.round(performance.now() - hostReadyStartedAt),
        totalElapsedMs: Math.round(performance.now() - initialLoadStartedAt),
      });
      if (!deps.target.sessionId.startsWith("temporary-")) {
        const diskResult = await deps.data
          .readSessionMessages(deps.target.workspaceId, deps.target.sessionId)
          .catch(
            /** @param {unknown} error */ (error) => {
              console.warn("[spopi] session load: initial disk history failed", error);
              return null;
            },
          );
        const diskMessages = diskResult?.messages ?? [];
        deps.diskHistoryFallback =
          diskMessages.length > 0
            ? { sessionId: deps.target.sessionId, messages: diskMessages }
            : null;
        console.info("[spopi] session load: initial disk fallback updated", {
          sessionId: deps.target.sessionId,
          messageCount: diskMessages.length,
          roles: summarizeMessageRoles(/** @type {Array<{ role?: string }>} */ (diskMessages)),
        });
        if (diskMessages.length > 0) {
          const renderStartedAt = performance.now();
          const hadInFlightPrompt = renderThroughStore(
            /** @type {import("../chat/transcript-reducer.js").TranscriptMessage[]} */ (
              diskMessages
            ),
          );
          deps.convNav.rebuild();
          console.info("[spopi] session load: initial disk history rendered", {
            sessionId: deps.target.sessionId,
            messageCount: diskMessages.length,
            elapsedMs: Math.round(performance.now() - renderStartedAt),
            totalElapsedMs: Math.round(performance.now() - initialLoadStartedAt),
          });
          deps.setStatus("connected");
          if (hadInFlightPrompt) await deps.extensionUi.flushForegroundQueue();
        }
      } else {
        deps.diskHistoryFallback = null;
        console.info("[spopi] session load: initial disk fallback skipped for temporary session", {
          sessionId: deps.target.sessionId,
        });
      }
      // On a phone, focus opens the keyboard over the conversation the page just loaded.
      if (document.body.dataset.layout !== "phone") deps.input.focus();
      const snapshotStartedAt = performance.now();
      await hydrateSnapshotOnce();
      console.info("[spopi] session load: initial Pi snapshot hydrated", {
        sessionId: deps.target.sessionId,
        elapsedMs: Math.round(performance.now() - snapshotStartedAt),
        totalElapsedMs: Math.round(performance.now() - initialLoadStartedAt),
      });
      await Promise.all([
        loadCommands()
          .then(() => deps.slashMenu.update())
          .catch(
            /** @param {unknown} error */ (error) => {
              console.warn("[spopi] Failed to load slash commands:", error);
            },
          ),
        deps
          .mountProjectHeader({
            data: deps.data,
            workspaceId: deps.target.workspaceId,
          })
          .catch(
            /** @param {unknown} error */ (error) => {
              console.warn("[spopi] Failed to load project header info:", error);
            },
          ),
        deps.loadAvailableModels().catch(
          /** @param {unknown} error */ (error) => {
            console.warn("[spopi] Failed to load available models:", error);
          },
        ),
      ]);
    } catch (error) {
      deps.showError(error);
    }
  }

  /**
   * @param {{
   *   target?: SessionTarget,
   *   event?: { type?: string, message?: { role?: string }, name?: unknown },
   * }} frame
   */
  async function handleBackgroundRuntimeEvent(frame) {
    const sessionId = frame.target?.sessionId;
    switch (frame.event?.type) {
      case "agent_start":
        deps.sidebar?.setStreaming(sessionId, true);
        deps.sidebar?.markUnread(sessionId);
        break;
      case "agent_settled":
      case "agent_end":
        deps.sidebar?.setStreaming(sessionId, false);
        deps.sidebar?.markUnread(sessionId);
        break;
      case "message_end":
        if (frame.event.message?.role === "assistant") deps.sidebar?.markUnread(sessionId);
        break;
      case "session_info_changed":
        deps.sidebar?.setSessionName(sessionId, frame.event.name);
        break;
    }
  }

  /**
   * @param {Array<{ target?: SessionTarget }> | null | undefined} sessions
   */
  function subscribeToLiveSessions(sessions) {
    deps.syncSessionInfo();
    for (const session of sessions ?? []) {
      const liveTarget = session?.target;
      if (liveTarget?.workspaceId && liveTarget?.sessionId && liveTarget?.instanceId) {
        const target = liveTarget;
        deps.adapter.subscribeTarget(target);
      }
    }
  }

  function setupSessionSidebar() {
    const next = deps.mountSessionSidebar({
      createSessionSelectionHandler: deps.createSessionSelectionHandler,
      switchSession,
      openSessionInProject,
      showError: deps.showError,
      onMissing: (/** @type {object} */ session) => {
        const record = session && typeof session === "object" ? session : {};
        const path = String(/** @type {{ projectPath?: unknown }} */ (record).projectPath || "");
        const workspaceId = String(
          /** @type {{ workspaceId?: unknown }} */ (record).workspaceId || "",
        );
        showMissingWorkspace({
          path,
          onError: deps.showError,
          onRemove: async () => {
            const control =
              /** @type {{ forgetWorkspace?: (request: { workspaceId: string, projectPath: string }) => Promise<unknown> } | null | undefined} */ (
                deps.control
              );
            await control?.forgetWorkspace?.({ workspaceId, projectPath: path });
            rememberHiddenLocal(uiStore, workspaceId, path);
            clearMissingWorkspace();
            deps.sidebar?.render?.();
          },
        });
      },
      SessionSidebar: deps.SessionSidebar,
      mountSessionSearchDialog: deps.mountSessionSearchDialog,
      data: deps.data,
      runtime: deps.runtime,
      control: deps.control,
      config: deps.config,
      getTarget: () => deps.target,
      createSessionViaHost: deps.createSessionViaHost,
      subscribeToLiveSessions,
      setActiveSearchQuery: /** @param {string} query */ (query) => {
        deps.activeSearchQuery = query;
      },
      applyActiveSearchHighlight: deps.applyActiveSearchHighlight,
    });
    if (next) deps.sidebar = next;
  }

  /**
   * A dated project that was opened and left without a chat or any file of
   * the user's is removed, so repeated New project clicks leave no folders.
   * @param {typeof deps} runtimeDeps
   * @param {string} workspaceId
   */
  async function sweepLeftProject(runtimeDeps, workspaceId) {
    const info = await runtimeDeps.data?.workspaceInfo?.(workspaceId).catch(() => null);
    const path = typeof info?.info?.path === "string" ? info.info.path : "";
    if (!path) return;
    await runtimeDeps.control?.sweepProject?.(path).catch(() => null);
  }

  return {
    getState,
    isWorking,
    subscribe,
    dispatch,
    commands,
    start,
    loadBootstrapTarget,
    hydrateSnapshot,
    hydrateSnapshotOnce,
    adoptTarget,
    switchSession,
    openSessionInProject,
    loadCommands,
    handleBackgroundRuntimeEvent,
    setupSessionSidebar,
  };
}
