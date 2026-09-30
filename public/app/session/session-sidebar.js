// ABOUTME: Renders the workspace session list and its grouping.
// ABOUTME: It loads sessions through the data gateway and emits selection upward.

import { basenameLocalPath } from "../files/path-utils.js";
import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { copyText } from "../ui/clipboard.js";
import { closeContextMenu, registerContextMenuHost, showContextMenu } from "../ui/context-menu.js";
import { confirmDialog, openDialog } from "../ui/dialog.js";
import { createIcon } from "../ui/icons.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { randomId } from "../utils/random-id.js";
import { isHiddenPath, rememberHiddenLocal, syncHiddenFromStore } from "./missing-workspace.js";
import { createPinnedItemsStore, startPinnedItemsSync } from "./pinned-items.js";
import { exportSessionHtml } from "./session-export.js";
import { sessionMenuRows } from "./session-menu.js";
import { sidebarSections } from "./session-sidebar-sections.js";
import { currentTreeLeaf, refreshSessionTree } from "./session-tree-host.js";
import { placeOpenProject } from "./sidebar-open-project.js";
import { buildSidebarSection } from "./sidebar-workspace-group.js";

/**
 * @param {unknown} result
 * @returns {{ cancelled?: boolean, sessionId?: string }}
 */
function rpcData(result) {
  if (!result || typeof result !== "object" || !("response" in result)) return {};
  const data =
    /** @type {{ response?: { data?: { cancelled?: boolean, sessionId?: string } } }} */ (result)
      .response?.data;
  return data ?? {};
}

/**
 * @typedef {object} SidebarSession
 * @property {string} id
 * @property {string | null} [name]
 * @property {string | null} [firstMessage]
 * @property {string | null} [timestamp]
 * @property {number | null} [modifiedAtMs]
 * @property {string | null} [projectPath]
 * @property {string | null} [projectName]
 * @property {boolean} [isCurrentWorkspace]
 * @property {string | null} [kind]
 * @property {string | null} [status]
 * @property {string | null} [state]
 * @property {boolean} [isWorking]
 * @property {boolean} [unread]
 * @property {boolean} [hasUnread]
 * @property {unknown} [target]
 * @property {string | null} [filePath]
 * @property {string} [workspaceId]
 * @property {string} [fileName]
 */

/**
 * @typedef {object} SidebarProject
 * @property {string} path
 * @property {string} name
 * @property {boolean} [isCurrent]
 * @property {SidebarSession[]} [sessions]
 * @property {SidebarSession[]} [archivedSessions]
 */

/**
 * @typedef {object} SidebarTarget
 * @property {string} [workspaceId]
 * @property {string} [sessionId]
 * @property {string} [instanceId]
 * @property {string} [cwd]
 */

/**
 * @typedef {object} ContextMenuRow
 * @property {boolean} [separator]
 * @property {string} [label]
 * @property {boolean} [disabled]
 * @property {() => void} [action]
 */

/**
 * @typedef {object} PinnedWorkspaceRef
 * @property {string} [path]
 * @property {string} [id]
 * @property {string} [folderName]
 */

/**
 * @typedef {object} PinnedGroup
 * @property {boolean} workspacePin
 * @property {boolean} unavailable
 * @property {PinnedWorkspaceRef | null} workspace
 * @property {SidebarSession[]} sessions
 */

/**
 * @typedef {object} PinState
 * @property {PinnedWorkspaceRef[]} workspaces
 * @property {string[]} sessions
 */

/**
 * @typedef {object} SessionSidebarOptions
 * @property {{
 *   listAllSessions: (workspaceId: string) => Promise<{ sessions?: SidebarSession[] }>,
 *   searchSessions: (workspaceId: string, query: string) => Promise<{ results?: object[] }>,
 *   workspaceInfo?: (workspaceId: string) => Promise<unknown>,
 * }} data
 * @property {{ request: (payload: object, target?: SidebarTarget | null, opts?: object) => Promise<unknown>, rebindSession?: (target: SidebarTarget | null | undefined, newSessionId: string) => Promise<{ sessionId?: string } | null | undefined> }} runtime
 * @property {{
 *   deleteSessions: (ids: string[]) => Promise<{ deleted?: string[] }>,
 *   revealPath?: (path: string, options?: { workspaceId?: string }) => Promise<unknown>,
 *   projectChats?: (path: string) => Promise<{ foreign?: number, recordedAt?: string, recordedExists?: boolean, insideProject?: boolean, inProjectsFolder?: boolean }>,
 *   relinkProject?: (path: string) => Promise<unknown>,
 *   keepChatsInProject?: (path: string) => Promise<unknown>,
 *   renameProject?: (path: string, name: string) => Promise<{ projectPath?: string, worktreeWarning?: string }>,
 *   closeProject?: (path: string) => Promise<unknown>,
 *   restartRuntime?: (workspaceId: string, sessionId: string) => Promise<unknown>,
 * }} [control]
 * @property {{ call: (method: string, args?: object, opts?: object) => Promise<{ ok?: boolean, error?: string, data?: { title?: string, sessions?: SidebarSession[] } }> }} [config]
 * @property {() => SidebarTarget | null | undefined} getTarget
 * @property {(session: SidebarSession | { id: string, isCurrentWorkspace?: boolean }) => void} onSelect
 * @property {(workspaceId?: string) => Promise<unknown> | unknown} [onCreateSession]
 * @property {(projectPath: string) => Promise<unknown> | unknown} [onCreateSessionInProject]
 * @property {(sessions: SidebarSession[]) => void} [onSessionsLoaded]
 * @property {() => Promise<{ sessions?: SidebarSession[] }>} [loadSessions]
 * @property {string} [cacheScope]
 * @property {(error: Error) => void} [onError]
 */

/**
 * @returns {{ __TAURI__?: { core?: { invoke?: (...args: unknown[]) => Promise<unknown> } } }}
 */
export function tauriGlobal() {
  return /** @type {{ __TAURI__?: { core?: { invoke?: (...args: unknown[]) => Promise<unknown> } } }} */ (
    globalThis
  );
}

/** Sidebar label for a workspace path. Windows `\\?\UNC\...` paths have no `/`.
 * @param {string | null | undefined} path
 * @param {string | null | undefined} [projectName]
 */
export function workspaceFolderName(path, projectName) {
  const fromName = typeof projectName === "string" ? projectName.trim() : "";
  if (fromName && !/[\\/]/.test(fromName)) return fromName;
  return basenameLocalPath(path) || fromName || path || "";
}

// Session sidebar on the host gateways:
//   - listing        → HostDataGateway.listSessions(workspaceId)   (flat list)
//   - full-text search→ HostDataGateway.searchSessions(workspaceId, query)
//   - rename/title    → RuntimeGateway for active sessions, ConfigGateway + Pi SessionManager for history
//   - selection       → navigate to the session route (page re-bootstraps)
//   - streaming/unread→ driven by the caller from runtime_event frames
//
// Sessions from every project are listed via HostDataGateway.listAllSessions and
// grouped by project: favourites → current project → other projects → archived.
// Selecting a session in the current project navigates in-window; selecting one
// from another project opens (or focuses) that project's workspace window at the
// session (native `open_session_in_project` command).
// Favourites, archived, unread, and collapse flags live in ui.* preferences.
// The session-list cache is memory-only; the host list is the source of truth.
export const STORAGE = {
  favourites: "ui.sessions.favourites",
  archived: "ui.sessions.archived",
  archivedOpen: "ui.sessions.archivedOpen",
  projectsCollapsed: "ui.sessions.projectsCollapsed",
  unread: "ui.sessions.unread",
  recent: "ui.sessions.recent",
  recentCollapsed: "ui.sessions.recentCollapsed",
};
const sessionCache = new Map();
export const INITIAL_LIMIT = 8;
export const STEP = 10;
const LOAD_RETRY_DELAYS_MS = [250, 750, 1500];

// Bounded so the Recent section never crowds out the project groups below it.
const MAX_RECENT_SESSIONS = 5;

/** @param {string} key @returns {Record<string, unknown>} */
function readObject(key) {
  try {
    const value = JSON.parse(uiStore.getItem(key) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** @param {string} key @returns {string[]} */
function readArray(key) {
  try {
    const value = JSON.parse(uiStore.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** @param {string} key @param {string} value */
export function writeStorage(key, value) {
  try {
    uiStore.setItem(key, value);
  } catch {
    // Sidebar preferences are best-effort; storage quota/private-mode errors
    // must not prevent the live UI interaction from completing.
  }
}

/** @param {string | null | undefined} workspaceId */
function sessionCacheKey(workspaceId) {
  return workspaceId || "latest";
}

/**
 * @param {string | null | undefined} workspaceId
 * @param {string | null | undefined} activeSessionId
 * @returns {SidebarSession[]}
 */
function readSessionCache(workspaceId, activeSessionId) {
  const workspaceValue = sessionCache.get(sessionCacheKey(workspaceId));
  if (Array.isArray(workspaceValue) && workspaceValue.length > 0) return workspaceValue;
  const latestValue = sessionCache.get("latest");
  return Array.isArray(latestValue) ? rebaseCachedSessions(latestValue, activeSessionId) : [];
}

/**
 * @param {string | null | undefined} workspaceId
 * @param {SidebarSession[]} sessions
 */
function writeSessionCache(workspaceId, sessions) {
  sessionCache.set(sessionCacheKey(workspaceId), sessions);
  sessionCache.set("latest", sessions);
}

export function clearSessionListCache() {
  sessionCache.clear();
}

/**
 * @param {string | null | undefined} workspaceId
 * @param {SidebarSession[]} sessions
 */
export function seedSessionListCache(workspaceId, sessions) {
  writeSessionCache(workspaceId, sessions);
}

/**
 * @param {SidebarSession[]} sessions
 * @param {string | null | undefined} activeSessionId
 * @returns {SidebarSession[]}
 */
function rebaseCachedSessions(sessions, activeSessionId) {
  const active = sessions.find((session) => session?.id === activeSessionId);
  const activeProjectPath = active?.projectPath;
  if (!activeProjectPath) return sessions;
  return sessions.map((session) => ({
    ...session,
    isCurrentWorkspace: session?.projectPath === activeProjectPath,
  }));
}

/** @param {SidebarSession[] | null | undefined} sessions */
function sessionListSignature(sessions) {
  return JSON.stringify(
    (sessions ?? []).map((session) => ({
      id: session?.id ?? null,
      name: session?.name ?? null,
      firstMessage: session?.firstMessage ?? null,
      timestamp: session?.timestamp ?? null,
      modifiedAtMs: session?.modifiedAtMs ?? null,
      projectPath: session?.projectPath ?? null,
      projectName: session?.projectName ?? null,
      isCurrentWorkspace: session?.isCurrentWorkspace === true,
      kind: session?.kind ?? null,
      status: session?.status ?? null,
      state: session?.state ?? null,
      isWorking: session?.isWorking === true,
      unread: session?.unread === true,
      hasUnread: session?.hasUnread === true,
      target: session?.target ?? null,
      filePath: session?.filePath ?? null,
    })),
  );
}

/** @param {string} value */
function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  // jsdom / older engines: session ids are UUIDs, so a conservative escape is safe.
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/** @param {SidebarSession | null | undefined} session */
/** @param {SidebarSession | null | undefined} session */
function isWorkingSession(session) {
  return (
    session?.status === "working" || session?.state === "working" || session?.isWorking === true
  );
}

/** @param {SidebarSession | null | undefined} session */
function hasLiveStatus(session) {
  return session?.status != null || session?.state != null || session?.isWorking != null;
}

/** @param {SidebarSession | null | undefined} session */
function isUnreadSession(session) {
  return session?.unread === true || session?.hasUnread === true;
}

/**
 * @param {SidebarSession | null | undefined} existing
 * @param {SidebarSession | null | undefined} incoming
 * @returns {SidebarSession}
 */
function mergeSessionSummary(existing, incoming) {
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
    id: incoming?.id ?? existing?.id ?? "",
    name: incoming?.name ?? existing?.name ?? null,
    firstMessage: existing?.firstMessage ?? incoming?.firstMessage ?? null,
    timestamp: incoming?.timestamp ?? existing?.timestamp ?? new Date().toISOString(),
    modifiedAtMs: incoming?.modifiedAtMs ?? existing?.modifiedAtMs ?? Date.now(),
  };
}

/** @param {string | null | undefined} isoTimestamp */
export function formatSessionTime(isoTimestamp) {
  if (!isoTimestamp) return "";
  try {
    const date = new Date(isoTimestamp);
    if (Number.isNaN(date.getTime())) return "";
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/**
 * @param {HTMLElement} container
 * @param {SessionSidebarOptions} options
 */
export class SessionSidebar {
  /**
   * @param {HTMLElement} container
   * @param {SessionSidebarOptions} options
   */
  constructor(
    container,
    {
      data,
      runtime,
      control,
      config,
      getTarget,
      onSelect,
      onCreateSession,
      onCreateSessionInProject,
      onSessionsLoaded,
      loadSessions,
      cacheScope,
      onError,
    },
  ) {
    this.container = container;
    this.onError = onError;
    this.data = data;
    this.runtime = runtime;
    this.control = control;
    this.config = config;
    this.getTarget = getTarget;
    this.onSelect = onSelect;
    this.onCreateSession = onCreateSession;
    this.onCreateSessionInProject = onCreateSessionInProject;
    this.onSessionsLoaded = onSessionsLoaded;
    this.loadSessions = loadSessions;
    this.cacheScope = cacheScope;

    /** @type {SidebarSession[]} */
    this.sessions = [];
    /** @type {import("./sidebar-open-project.js").OpenProject | null} */
    this.openProject = null;
    /** @type {string | null} */
    this.activeSessionId = getTarget()?.sessionId ?? null;
    /** @type {string[]} */
    this.favourites = readArray(STORAGE.favourites);
    /** @type {string[]} */
    this.archived = readArray(STORAGE.archived);
    /** @type {Record<string, boolean>} */
    this.archivedOpen = /** @type {Record<string, boolean>} */ (readObject(STORAGE.archivedOpen));
    /** @type {Map<string, { foreign?: number, recordedAt?: string, recordedExists?: boolean, insideProject?: boolean, inProjectsFolder?: boolean }>} */
    this.chatReports = new Map();
    this._chatReportsStale = true;
    /** @type {Record<string, unknown>} */
    this.projectsCollapsed = readObject(STORAGE.projectsCollapsed);
    /** @type {string[]} */
    this.recent = readArray(STORAGE.recent).slice(0, MAX_RECENT_SESSIONS);
    this.recentCollapsed = uiStore.getItem(STORAGE.recentCollapsed) !== "false";
    // In-memory collapse state for PINNED: it resets every app launch so a
    // previous session's expand choice does not carry over.
    this.pinnedCollapsed = false;
    /** @type {Set<string>} */
    this.unread = new Set(readArray(STORAGE.unread));
    /** @type {Set<string>} */
    this.streaming = new Set();

    this.searchQuery = "";
    /** @type {object[] | null} */
    this._searchResults = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._searchTimer = null;
    /** @type {Map<string, number>} */
    this._visibleCountsByProject = new Map();
    this._loadSeq = 0;
    this._loadCommitted = 0;
    this.contextMenu = null;

    // Pin store + sync. Persists workspace/session Pins in the host preference DB.
    this.pinnedStore = createPinnedItemsStore();
    this._unsubscribePinned = this.pinnedStore.subscribe(() => this.render());
    this._stopPinnedSync = startPinnedItemsSync({});

    this._onDocumentClick = () => this.closeContextMenu();
    document.addEventListener("click", this._onDocumentClick);
  }

  /** Re-read ui.* values after the preference cache loads. */
  reloadUiPrefs() {
    this.favourites = readArray(STORAGE.favourites);
    this.archived = readArray(STORAGE.archived);
    this.archivedOpen = /** @type {Record<string, boolean>} */ (readObject(STORAGE.archivedOpen));
    this.projectsCollapsed = readObject(STORAGE.projectsCollapsed);
    this.recent = readArray(STORAGE.recent).slice(0, MAX_RECENT_SESSIONS);
    this.recentCollapsed = uiStore.getItem(STORAGE.recentCollapsed) !== "false";
    this.unread = new Set(readArray(STORAGE.unread));
    this.pinnedStore?.refresh?.();
    this.render();
  }

  // ── persistence ────────────────────────────────────────────────
  /** @param {string} key @param {unknown} value */
  #save(key, value) {
    writeStorage(key, JSON.stringify(value));
  }
  /** @param {string} id */
  isFavourite(id) {
    return this.favourites.includes(id);
  }
  /** @param {string} id */
  isArchived(id) {
    return this.archived.includes(id);
  }
  /** @param {string} id */
  toggleFavourite(id) {
    const idx = this.favourites.indexOf(id);
    if (idx >= 0) this.favourites.splice(idx, 1);
    else this.favourites.push(id);
    this.#save(STORAGE.favourites, this.favourites);
    this.render();
  }
  /** @param {string} id */
  toggleArchived(id) {
    const idx = this.archived.indexOf(id);
    if (idx >= 0) this.archived.splice(idx, 1);
    else this.archived.push(id);
    this.#save(STORAGE.archived, this.archived);
    this.render();
  }

  // Record a session as just-accessed, moving it to the front of the recents
  // list. Bounded to MAX_RECENT_SESSIONS so the section stays scannable.
  // Called from setActive() so every navigation path (sidebar click, route
  // boot, external link) converges on one recording point.
  /** @param {string | null | undefined} id */
  #recordRecent(id) {
    if (!id) return;
    const next = [id, ...this.recent.filter((existing) => existing !== id)].slice(
      0,
      MAX_RECENT_SESSIONS,
    );
    if (JSON.stringify(next) === JSON.stringify(this.recent)) return;
    this.recent = next;
    this.#save(STORAGE.recent, this.recent);
  }

  // Join the stored recent ids against the loaded session list, dropping ids
  // that no longer resolve to a visible (non-archived) session. The prune is
  // lazy: we only rewrite storage when the set actually shrank, avoiding
  // write churn on every render.
  /** @returns {SidebarSession[]} */
  #resolveRecentSessions() {
    if (this.recent.length === 0) return [];
    const byId = new Map(this.sessions.map((session) => [session.id, session]));
    const resolved = this.recent
      .map((id) => byId.get(id))
      .filter(
        /** @returns {session is SidebarSession} */
        (session) => Boolean(session?.id && !this.isArchived(session.id)),
      );
    const validIds = resolved.map((session) => session.id).filter(Boolean);
    if (JSON.stringify(validIds) !== JSON.stringify(this.recent)) {
      this.recent = /** @type {string[]} */ (validIds);
      this.#save(STORAGE.recent, this.recent);
    }
    return resolved;
  }

  /** @param {SidebarProject} project */
  archiveProject(project) {
    const ids = this.sessions
      .filter((session) => session.projectPath === project.path)
      .map((session) => session.id)
      .filter(/** @returns {id is string} */ (id) => typeof id === "string" && Boolean(id));
    if (ids.length === 0) return;

    const projectIds = new Set(ids);
    this.archived = [...new Set([...this.archived, ...ids])];
    this.favourites = this.favourites.filter((id) => !projectIds.has(id));
    this.#save(STORAGE.archived, this.archived);
    this.#save(STORAGE.favourites, this.favourites);
    this.render();
  }

  /**
   * The chat must not keep showing a conversation whose file is gone, so when
   * the open session is in `ids`, move to a fresh session in the same project
   * first. If that fails the open session is left out of the batch.
   * @param {string[]} ids
   * @returns {Promise<string[]>}
   */
  async #leaveIfDeletingActive(ids) {
    const active = this.activeSessionId;
    if (!active || !ids.includes(active)) return ids;
    try {
      await this.onCreateSession?.(this.getTarget()?.workspaceId);
      return ids;
    } catch (error) {
      console.error("[Sidebar] could not open a fresh session before deleting:", error);
      return ids.filter((id) => id !== active);
    }
  }

  // Deletes every session of one workspace in a single confirmed batch,
  // including the open one (the chat moves to a fresh session first). Sessions
  // that are streaming stay: the runtime owns their lifecycle. Only ids the
  // backend confirms as deleted are dropped locally. Ids derive from
  // this.sessions by project.path so both menu call sites work: project groups
  // pass a project with .sessions, pinned-workspace groups pass only { path, name }.
  /** @param {SidebarProject | { path?: string, name?: string }} project */
  async deleteWorkspaceSessions(project) {
    if (!this.control) return;
    const candidates = this.sessions
      .filter((session) => session.projectPath === project?.path)
      .map((session) => session.id)
      .filter(
        /** @returns {id is string} */
        (id) => typeof id === "string" && Boolean(id) && !this.streaming.has(id),
      );
    if (candidates.length === 0) return;
    const ok = await this.#confirmDialog({
      message: t("sidebar.deleteWorkspaceConfirm", { count: candidates.length }),
      ariaLabel: t("sidebar.deleteWorkspaceSessions"),
    });
    if (!ok) return;
    const deletable = await this.#leaveIfDeletingActive(candidates);
    if (deletable.length === 0) return;
    try {
      const { deleted } = await this.control.deleteSessions(deletable);
      const deletedSet = new Set(deleted || []);
      if (deletedSet.size === 0) return;
      for (const id of deletable) {
        if (deletedSet.has(id)) this.pinnedStore?.unpinSession(id);
      }
      this.archived = this.archived.filter((id) => !deletedSet.has(id));
      this.#save(STORAGE.archived, this.archived);
      this.sessions = this.sessions.filter((session) => !deletedSet.has(session.id));
      this.render();
    } catch (error) {
      this.#reportError(error);
    }
  }

  // Permanently deletes every archived session from disk (after a confirm
  // dialog) and drops the successfully-deleted ids from local state.
  /**
   * @param {string[]} [only]
   */
  async deleteAllArchived(only) {
    const targets = (only ?? this.archived).filter((id) => this.archived.includes(id));
    if (targets.length === 0 || !this.control) return;
    const ok = await this.#confirmArchivedDeletion(targets.length);
    if (!ok) return;
    const ids = await this.#leaveIfDeletingActive(targets);
    if (ids.length === 0) return;
    try {
      const { deleted } = await this.control.deleteSessions(ids);
      const deletedSet = new Set(deleted);
      this.archived = this.archived.filter((id) => !deletedSet.has(id));
      this.#save(STORAGE.archived, this.archived);
      this.sessions = this.sessions.filter((session) => !deletedSet.has(session.id));
      this.render();
    } catch (error) {
      this.#reportError(error);
    }
  }

  /** @param {number} count */
  #confirmArchivedDeletion(count) {
    const message = t(
      count === 1 ? "sidebar.deleteArchivedConfirmOne" : "sidebar.deleteArchivedConfirmOther",
      { count },
    );
    return this.#confirmDialog({ message, ariaLabel: t("sidebar.deleteArchived") });
  }

  /**
   * @param {{ message: string, ariaLabel: string }} options
   * @returns {Promise<boolean>}
   */
  #confirmDialog({ message, ariaLabel }) {
    return new Promise((resolve) => {
      let settled = false;
      /** @param {boolean} result */
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const body = document.createElement("div");
      body.className = "sidebar-confirm-message";
      body.textContent = message;
      const handle = openDialog({
        body,
        actions: [
          {
            label: t("actions.cancel"),
            className: "sidebar-confirm-no",
            onClick: () => {
              finish(false);
              handle.close();
            },
          },
          {
            label: t("actions.delete"),
            className: "sidebar-confirm-yes",
            onClick: () => {
              finish(true);
              handle.close();
            },
          },
        ],
        onClose: () => finish(false),
      });
      handle.element.setAttribute("aria-label", ariaLabel);
    });
  }

  // ── status indicators (driven by the caller) ───────────────────
  /**
   * Pi writes a session file only after the first message. A cold spawn has a
   * `temporary-` id, but an adopted standby already has Pi's own id, so the saved
   * list decides once the host has answered; the cached first paint does not.
   * @param {unknown} id
   */
  isUnsavedSession(id) {
    if (typeof id !== "string" || !id) return false;
    if (id.startsWith("temporary-")) return true;
    return this._loadCommitted > 0 && !this.sessions.some((session) => session?.id === id);
  }

  /** @param {string | null | undefined} sessionId */
  setActive(sessionId) {
    const redraw = this.isUnsavedSession(this.activeSessionId) || this.isUnsavedSession(sessionId);
    this.activeSessionId = sessionId ?? null;
    if (sessionId && this.unread.has(sessionId)) {
      this.unread.delete(sessionId);
      this.#save(STORAGE.unread, [...this.unread]);
    }
    this.#recordRecent(sessionId);
    if (redraw) {
      this.render();
      return;
    }
    this.container.querySelectorAll(".session-item").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const isActive = el.dataset.sessionId === sessionId;
      el.classList.toggle("active", isActive);
      if (isActive) el.classList.remove("unread");
    });
  }
  /** @param {string | null | undefined} id */
  markUnread(id) {
    if (!id || id === this.activeSessionId || this.unread.has(id)) return;
    this.unread.add(id);
    this.#save(STORAGE.unread, [...this.unread]);
    this.#applyStatus(id);
  }
  /** @param {string | null | undefined} id */
  markRead(id) {
    if (!id || !this.unread.has(id)) return;
    this.unread.delete(id);
    this.#save(STORAGE.unread, [...this.unread]);
    this.#applyStatus(id);
  }
  /**
   * @param {string | null | undefined} id
   * @param {boolean} streaming
   */
  setStreaming(id, streaming) {
    if (!id) return;
    const had = this.streaming.has(id);
    if (streaming && !had) this.streaming.add(id);
    else if (!streaming && had) this.streaming.delete(id);
    else return;
    this.#applyStatus(id);
  }
  clearStreaming() {
    if (this.streaming.size === 0) return;
    const ids = [...this.streaming];
    this.streaming.clear();
    ids.forEach((id) => {
      this.#applyStatus(id);
    });
  }
  /** @param {string} id */
  #applyStatus(id) {
    this.container
      .querySelectorAll(`.session-item[data-session-id="${cssEscape(id)}"]`)
      .forEach((el) => {
        el.classList.toggle("unread", this.unread.has(id));
        el.classList.toggle("streaming", this.streaming.has(id));
        el.classList.toggle("mirror-live", this.streaming.has(id));
      });
  }

  // ── loading ─────────────────────────────────────────────────────
  /**
   * @param {{ quiet?: boolean, retryAttempt?: number }} [options]
   */
  async load({ quiet = false, retryAttempt = 0 } = {}) {
    const seq = ++this._loadSeq;
    const workspaceId = this.getTarget()?.workspaceId ?? this.cacheScope;
    if (!workspaceId) return;
    let renderedFromCache = false;
    if (!quiet && this.sessions.length === 0) {
      const cachedSessions = readSessionCache(workspaceId, this.activeSessionId);
      if (cachedSessions.length > 0) {
        this.sessions = cachedSessions;
        this.#hydrateStatuses(this.sessions);
        this.onSessionsLoaded?.(this.sessions);
        this.render();
        renderedFromCache = true;
      }
    }
    if (!quiet && this.sessions.length === 0) {
      this.container.replaceChildren(
        ...Array.from({ length: 6 }, () => {
          const skel = document.createElement("div");
          skel.className = "session-skeleton";
          const skelTitle = document.createElement("div");
          skelTitle.className = "session-skeleton-title";
          skel.appendChild(skelTitle);
          return skel;
        }),
      );
    }
    const previousSignature = sessionListSignature(this.sessions);
    try {
      const response = this.loadSessions
        ? await this.loadSessions()
        : await this.data.listAllSessions(workspaceId);
      if (seq < this._loadCommitted) return;
      this._loadCommitted = seq;
      const receivedSessions = response.sessions ?? [];
      // The first request can race host/bootstrap registration and briefly
      // return an empty list. Do not let that transient response erase a
      // non-empty cache; a post-bootstrap reload will
      // replace it with the authoritative list moments later.
      const nextSessions =
        receivedSessions.length === 0 && this.sessions.length > 0
          ? [...this.sessions]
          : receivedSessions;
      // Preserve a just-created active session that the server hasn't persisted
      // yet. Without this, a quiet reload fired right after upsertSession (e.g.
      // on session_bound) overwrites the list with the on-disk snapshot and the
      // new session vanishes until a manual refresh.
      const activeId = this.activeSessionId;
      if (activeId && !nextSessions.some((session) => session?.id === activeId)) {
        const local = this.sessions.find((session) => session?.id === activeId);
        if (local) nextSessions.unshift(local);
      }
      const changed = sessionListSignature(nextSessions) !== previousSignature;
      this.sessions = nextSessions;
      let reportsChanged = false;
      if (changed || this._chatReportsStale) {
        this._chatReportsStale = false;
        const before = JSON.stringify([...this.chatReports]);
        await this.refreshChatReports();
        if (seq < this._loadCommitted) return;
        reportsChanged = JSON.stringify([...this.chatReports]) !== before;
      }
      this.#hydrateStatuses(this.sessions, { authoritative: true });
      writeSessionCache(workspaceId, this.sessions);
      this.onSessionsLoaded?.(this.sessions);
      if (changed || reportsChanged || (!quiet && !renderedFromCache)) this.render();
      void this.#loadOpenProject();
    } catch (error) {
      if (seq < this._loadCommitted) return;
      const retryDelay = LOAD_RETRY_DELAYS_MS[retryAttempt];
      if (retryDelay != null) {
        console.warn("[Sidebar] Session load failed; retrying:", error);
        if (!quiet && this.sessions.length === 0) {
          this.container.replaceChildren(
            createLoadingPlaceholder({
              className: "session-loading",
              label: t("sidebar.loadingSessions"),
            }),
          );
        }
        setTimeout(() => {
          if (seq === this._loadSeq) {
            this.load({ quiet: true, retryAttempt: retryAttempt + 1 });
          }
        }, retryDelay);
        return;
      }
      console.error("[Sidebar] Failed to load sessions:", error);
      if (this.sessions.length > 0) return;
      const loadingEl = document.createElement("div");
      loadingEl.className = "session-loading";
      loadingEl.textContent = `${t("sidebar.failedToLoadSessions")} `;
      const retryLink = document.createElement("button");
      retryLink.className = "retry-link";
      retryLink.id = "retry-load-sessions";
      retryLink.textContent = t("sidebar.retry");
      loadingEl.appendChild(retryLink);
      this.container.replaceChildren(loadingEl);
      retryLink.addEventListener("click", () => this.load());
    }
  }

  /** @param {SidebarSession} session */
  upsertSession(session) {
    if (!session?.id) return;
    const index = this.sessions.findIndex((existing) => existing.id === session.id);
    const existing = index >= 0 ? this.sessions[index] : null;
    // Never borrow the folder of a chat from another project: a new project's
    // first chat would be filed under it and that project shown as open.
    const projectFallback = /** @type {Partial<SidebarSession>} */ (
      existing ??
        this.sessions.find((candidate) => candidate.isCurrentWorkspace) ??
        this.#currentOpenProject() ??
        {}
    );
    const next = mergeSessionSummary(existing, {
      workspaceId: this.getTarget()?.workspaceId ?? projectFallback.workspaceId ?? "",
      projectPath: projectFallback.projectPath ?? this.getTarget()?.workspaceId ?? "unknown",
      projectName: projectFallback.projectName ?? projectFallback.projectPath ?? "Current project",
      isCurrentWorkspace: true,
      fileName: "",
      ...session,
    });

    if (index >= 0) this.sessions.splice(index, 1);
    this.sessions.unshift(next);
    this.#hydrateStatuses(this.sessions);
    writeSessionCache(this.getTarget()?.workspaceId, this.sessions);
    this.onSessionsLoaded?.(this.sessions);
    this.render();
    if (!projectFallback.projectPath) void this.#fillProjectPath(next.id);
  }

  /**
   * With no other session of the open project in the list (a fresh start, or
   * right after deleting them all) the workspace id stood in for the folder, so
   * the session grouped under a separate "Current project". Ask the host for
   * the real folder and move it under that project.
   * @param {string | undefined} sessionId
   */
  async #fillProjectPath(sessionId) {
    const workspaceId = this.getTarget()?.workspaceId;
    if (!workspaceId || !this.data?.workspaceInfo) return;
    try {
      const frame = /** @type {{ info?: { path?: string }, path?: string } | null} */ (
        await this.data.workspaceInfo(workspaceId)
      );
      const path = frame?.info?.path ?? frame?.path ?? "";
      if (!path) return;
      const session = this.sessions.find((candidate) => candidate.id === sessionId);
      if (!session || session.projectPath !== workspaceId) return;
      session.projectPath = path;
      session.projectName = basenameLocalPath(path) || path;
      writeSessionCache(workspaceId, this.sessions);
      this.render();
    } catch {
      // The placeholder group stays until the next load corrects it.
    }
  }

  #currentOpenProject() {
    const workspaceId = this.getTarget()?.workspaceId;
    return workspaceId && this.openProject?.workspaceId === workspaceId ? this.openProject : null;
  }

  async #loadOpenProject() {
    const workspaceId = this.getTarget()?.workspaceId;
    if (!workspaceId || this.cacheScope === "launcher" || !this.data?.workspaceInfo) return;
    if (this.#currentOpenProject()) return;
    try {
      const frame = /** @type {{ info?: { path?: string }, path?: string } | null} */ (
        await this.data.workspaceInfo(workspaceId)
      );
      const path = frame?.info?.path ?? frame?.path ?? "";
      if (!path || this.getTarget()?.workspaceId !== workspaceId) return;
      this.openProject = {
        workspaceId,
        projectPath: path,
        projectName: basenameLocalPath(path) || path,
      };
      if (!this.sessions.some((session) => session.isCurrentWorkspace)) this.render();
    } catch {
      // Without the folder the open project shows once its first chat is saved.
    }
  }

  // ── search ──────────────────────────────────────────────────────
  /** @param {string | null | undefined} query */
  setSearchQuery(query) {
    this.searchQuery = (query || "").toLowerCase().trim();
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!this.searchQuery) {
      this._searchResults = null;
      this.applySearch();
      return;
    }
    this.applySearch();
    if (this.searchQuery.length >= 2) {
      this._searchTimer = setTimeout(() => this.#fullTextSearch(this.searchQuery), 300);
    }
  }

  /** @param {string} query */
  async #fullTextSearch(query) {
    if (query !== this.searchQuery) return;
    const workspaceId = this.getTarget()?.workspaceId;
    if (!workspaceId) return;
    try {
      const response = await this.data.searchSessions(workspaceId, query);
      if (query !== this.searchQuery) return;
      this._searchResults = response.results ?? [];
      this.#renderSearchResults();
    } catch (error) {
      console.error("[Sidebar] Search failed:", error);
    }
  }

  #renderSearchResults() {
    if (!this._searchResults || this._searchResults.length === 0) return;
    this.container.querySelector(".search-results-group")?.remove();

    const group = document.createElement("div");
    group.className = "search-results-group";
    const header = document.createElement("div");
    header.className = "project-header search-results-header";
    header.setAttribute("role", "presentation");
    const searchIcon = document.createElement("span");
    searchIcon.textContent = "\u{1F50D}";
    const matchesLabel = document.createElement("span");
    matchesLabel.textContent = t("sidebar.messageMatches");
    const countBadge = document.createElement("span");
    countBadge.className = "project-count";
    countBadge.textContent = String(this._searchResults.length);
    header.append(searchIcon, matchesLabel, countBadge);
    group.appendChild(header);

    const sessionsDiv = document.createElement("div");
    sessionsDiv.className = "project-sessions";
    for (const result of this._searchResults) {
      const typed =
        /** @type {{ sessionId?: string, sessionName?: string, firstMessage?: string, matches?: { snippet?: string }[], sessionTimestamp?: string }} */ (
          result
        );
      const item = document.createElement("div");
      item.className = "session-item search-result-item";
      item.dataset.sessionId = typed.sessionId ?? "";
      if (typed.sessionId === this.activeSessionId) item.classList.add("active");
      const title = typed.sessionName || typed.firstMessage || t("sidebar.untitled");
      const snippet = typed.matches?.[0]?.snippet || "";
      const matchCount = typed.matches?.length ?? 0;
      const time = formatSessionTime(typed.sessionTimestamp);
      const titleRow = document.createElement("div");
      titleRow.className = "session-title-row";
      const titleElement = document.createElement("div");
      titleElement.className = "session-title";
      titleElement.title = title;
      titleElement.textContent = title;
      titleRow.appendChild(titleElement);
      item.appendChild(titleRow);

      const snippetEl = document.createElement("div");
      snippetEl.className = "search-snippet";
      snippetEl.textContent = snippet;
      item.appendChild(snippetEl);

      const metaEl = document.createElement("div");
      metaEl.className = "session-meta";
      metaEl.textContent =
        matchCount > 1 ? `${time} · ${t("sidebar.matchCount", { count: matchCount })}` : time;
      item.appendChild(metaEl);

      item.addEventListener("click", () =>
        this.onSelect({ id: typed.sessionId ?? "", isCurrentWorkspace: true }),
      );
      sessionsDiv.appendChild(item);
    }
    group.appendChild(sessionsDiv);
    this.container.insertBefore(group, this.container.firstChild);
  }

  applySearch() {
    if (!this.searchQuery) {
      this.container.querySelectorAll(".session-item").forEach((el) => {
        el.classList.remove("hidden");
      });
      this.container
        .querySelectorAll(".favourites-group, .project-group, .archived-group")
        .forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          el.style.display = "";
        });
      this.container.querySelector(".search-results-group")?.remove();
      return;
    }
    this.container
      .querySelectorAll(".favourites-group, .project-group, .archived-group")
      .forEach((group) => {
        if (!(group instanceof HTMLElement)) return;
        let hasVisible = false;
        group.querySelectorAll(".session-item").forEach((item) => {
          const title = (item.querySelector(".session-title")?.textContent || "").toLowerCase();
          const matches = title.includes(this.searchQuery);
          item.classList.toggle("hidden", !matches);
          if (matches) hasVisible = true;
        });
        group.style.display = hasVisible ? "" : "none";
      });
  }

  /**
   * @param {SidebarSession[]} sessions
   * @param {{ authoritative?: boolean }} [options]
   */
  #hydrateStatuses(sessions, { authoritative = false } = {}) {
    const listedIds = new Set();
    for (const session of sessions) {
      if (!session?.id) continue;
      listedIds.add(session.id);
      if (isWorkingSession(session)) this.streaming.add(session.id);
      else if (authoritative || hasLiveStatus(session)) this.streaming.delete(session.id);

      if (isUnreadSession(session) && session.id !== this.activeSessionId)
        this.unread.add(session.id);
      else if (session.id === this.activeSessionId) this.unread.delete(session.id);
    }
    if (authoritative) {
      for (const id of this.streaming) {
        if (!listedIds.has(id)) this.streaming.delete(id);
      }
    }
    this.#save(STORAGE.unread, [...this.unread]);
  }

  // ── item + section builders ─────────────────────────────────────
  // Built with the DOM API so all workspace-supplied text stays inert.
  /**
   * @param {SidebarSession} session
   * @param {{ showArchiveButton?: boolean, showPinButton?: boolean }} [options]
   */
  #buildItem(session, { showArchiveButton = true, showPinButton = true } = {}) {
    const item = document.createElement("div");
    item.className = "session-item";
    item.dataset.sessionId = session.id;
    if (session.id === this.activeSessionId) item.classList.add("active");
    if (this.unread.has(session.id)) item.classList.add("unread");
    if (this.streaming.has(session.id)) item.classList.add("streaming", "mirror-live");

    const title = session.name || session.firstMessage || t("sidebar.emptySession");
    const isArchived = this.isArchived(session.id);
    const isPinned = this.pinnedStore?.isSessionPinned(session.id) ?? false;
    const pinBtnLabel = isPinned ? t("sidebar.unpinSession") : t("sidebar.pinSession");
    const archiveBtnLabel = isArchived
      ? t("sidebar.unarchiveSession")
      : t("sidebar.archiveSession");

    const titleRow = document.createElement("div");
    titleRow.className = "session-title-row";
    const titleElement = document.createElement("div");
    titleElement.className = "session-title";
    titleElement.title = title;
    titleElement.textContent = title;
    titleRow.appendChild(titleElement);

    const actionSlot = document.createElement("span");
    actionSlot.className = "session-action-slot";
    titleRow.appendChild(actionSlot);
    item.appendChild(titleRow);

    item.addEventListener("click", () => this.onSelect(session));
    item.addEventListener("contextmenu", (event) =>
      this.#showContextMenu(/** @type {MouseEvent} */ (event), session),
    );
    registerContextMenuHost(item);

    if (showPinButton && session.filePath) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "session-pin-btn";
      pinBtn.title = pinBtnLabel;
      pinBtn.setAttribute("aria-label", pinBtnLabel);
      pinBtn.setAttribute("aria-pressed", String(isPinned));
      const pinIconWrap = document.createElement("span");
      pinIconWrap.className = "session-pin-icon";
      const pinGlyph = createIcon("pin", { size: 13 });
      if (pinGlyph) pinIconWrap.appendChild(pinGlyph);
      pinBtn.appendChild(pinIconWrap);
      pinBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (this.pinnedStore?.isSessionPinned(session.id)) {
          this.pinnedStore.unpinSession(session.id);
        } else {
          this.pinnedStore.pinSession(session.id);
        }
        this.render();
      });
      actionSlot.appendChild(pinBtn);
    }

    if (session.filePath) {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "session-rename-btn";
      const renameLabel = t("sidebar.rename");
      renameBtn.title = renameLabel;
      renameBtn.setAttribute("aria-label", renameLabel);
      const renameIcon = createIcon("pencil", { size: 13 });
      if (renameIcon) renameBtn.appendChild(renameIcon);
      renameBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.#startRename(session);
      });
      actionSlot.appendChild(renameBtn);
    }

    if (showArchiveButton) {
      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "session-archive-btn";
      archiveBtn.title = archiveBtnLabel;
      archiveBtn.setAttribute("aria-label", archiveBtnLabel);
      const archiveGlyph = createIcon("archive");
      if (archiveGlyph) archiveBtn.appendChild(archiveGlyph);
      archiveBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleArchived(session.id);
      });
      actionSlot.appendChild(archiveBtn);
    }

    return item;
  }

  /**
   * Header from markup whose workspace text the caller has already escaped.
   * @param {string} className
   * @param {string} innerHtml
   */
  #sectionHeader(className, innerHtml) {
    const header = document.createElement("div");
    header.className = `project-header ${className}`;
    // DOMParser keeps any script in the markup inert.
    const doc = new DOMParser().parseFromString(innerHtml, "text/html");
    header.append(...doc.body.childNodes);
    return header;
  }

  render() {
    syncHiddenFromStore(uiStore);
    this.container.replaceChildren();

    const pinState = /** @type {PinState} */ (this.pinnedStore.getState());
    const hasAnyPins = pinState.workspaces.length > 0 || pinState.sessions.length > 0;

    if (this.sessions.length === 0 && !hasAnyPins && !this.#currentOpenProject()) {
      const empty = document.createElement("div");
      empty.className = "session-loading";
      empty.textContent = t("sidebar.noSavedSessions");
      this.container.appendChild(empty);
      return;
    }

    // Partition sessions into archived / regular (excludes pinned).
    const pinnedWorkspacePaths = new Set(pinState.workspaces.map((w) => w.path || w.id));
    const pinnedSessionIds = new Set(pinState.sessions);
    /** @type {SidebarSession[]} */
    const archived = [];
    /** @type {SidebarSession[]} */
    const regular = [];
    for (const session of this.sessions) {
      if (isHiddenPath(session.projectPath)) continue;
      if (session.id && this.isArchived(session.id)) {
        archived.push(session);
      } else if (
        session.id &&
        !pinnedSessionIds.has(session.id) &&
        !(session.projectPath && pinnedWorkspacePaths.has(session.projectPath))
      ) {
        regular.push(session);
      }
    }

    // ── RECENT ──────────────────────────────────────────────────
    const recentSessions = this.#resolveRecentSessions();
    if (recentSessions.length > 0) {
      const { section } = buildSidebarSection({
        region: "recent",
        titleKey: "sidebar.recent",
        count: recentSessions.length,
        expanded: !this.recentCollapsed,
        /** @param {boolean} expanded */
        onToggle: (expanded) => {
          this.recentCollapsed = !expanded;
          writeStorage(STORAGE.recentCollapsed, String(this.recentCollapsed));
        },
        /** @param {HTMLElement} body */
        renderSessions: (body) => {
          for (const session of recentSessions) {
            body.appendChild(this.#buildItem(session));
          }
        },
      });
      section.classList.add("recent-group");
      this.container.appendChild(section);
    }

    // ── PINNED ──────────────────────────────────────────────────
    this.renderPinnedSection(pinState);

    // ── PROJECTS ────────────────────────────────────────────────
    const archivedByPath = new Map();
    for (const session of archived) {
      const path = session.projectPath || "unknown";
      if (pinnedWorkspacePaths.has(path)) continue;
      const list = archivedByPath.get(path) ?? [];
      list.push(session);
      archivedByPath.set(path, list);
    }
    const projects = this.groupByProject(regular);
    for (const project of projects) {
      project.archivedSessions = archivedByPath.get(project.path) ?? [];
      archivedByPath.delete(project.path);
    }
    for (const [path, sessions] of archivedByPath) {
      projects.push({
        path,
        name: sessions[0]?.projectName || path,
        isCurrent: false,
        sessions: [],
        archivedSessions: sessions,
      });
    }
    placeOpenProject(projects, this.#currentOpenProject(), pinnedWorkspacePaths);
    if (projects.length > 0) {
      const { section: projectsSection } = buildSidebarSection({
        region: "projects",
        titleKey: "sidebar.projects",
        count: projects.length,
        expanded: true,
        /** @param {HTMLElement} body */
        renderSessions: (body) => {
          for (const project of projects) {
            body.appendChild(this.buildProjectGroup(project));
          }
        },
      });
      projectsSection.classList.add("projects-group");
      this.container.appendChild(projectsSection);
    }

    if (this.searchQuery) this.applySearch();
  }

  // ── context menu ────────────────────────────────────────────────
  /**
   * @param {MouseEvent} event
   * @param {SidebarSession} session
   */
  #showContextMenu(event, session) {
    event.preventDefault();
    this.#showMenu(
      event,
      sessionMenuRows(session, {
        activeSessionId: this.activeSessionId,
        isFavourite: (id) => this.isFavourite(id),
        toggleFavourite: (id) => this.toggleFavourite(id),
        isArchived: (id) => this.isArchived(id),
        toggleArchived: (id) => this.toggleArchived(id),
        isSessionPinned: (id) => this.pinnedStore?.isSessionPinned(id) ?? false,
        isWorkspacePinned: (path) => this.pinnedStore?.isWorkspacePinned(path) ?? false,
        pinSession: (id) => this.pinnedStore.pinSession(id),
        unpinSession: (id) => this.pinnedStore.unpinSession(id),
        render: () => this.render(),
        generateTitle: (item) => void this.#generateTitle(/** @type {SidebarSession} */ (item)),
        startRename: (item) => this.#startRename(/** @type {SidebarSession} */ (item)),
        duplicateSession: () => void this.#duplicateSession(),
        addLabel: () => void this.#addLabel(),
        exportHtml: () => void this.#exportHtml(),
      }),
    );
  }

  /**
   * @param {MouseEvent} event
   * @param {SidebarProject | { path?: string, name?: string }} project
   */
  #showProjectContextMenu(event, project) {
    event.preventDefault();
    const projectPath = project.path ?? "";
    const isWorkspacePinned = this.pinnedStore?.isWorkspacePinned(projectPath) ?? false;
    // The host only reveals folders of the open workspace.
    const isOpen =
      ("isCurrent" in project && project.isCurrent === true) ||
      this.sessions.some(
        (session) => session.projectPath === projectPath && session.isCurrentWorkspace,
      );
    const revealPath = this.control?.revealPath;
    /** @type {ContextMenuRow[]} */
    const rows = [
      ...(isOpen && revealPath
        ? [
            {
              label: t("files.revealInExplorer"),
              action: () =>
                void revealPath
                  .call(this.control, projectPath, { workspaceId: this.getTarget()?.workspaceId })
                  .catch((/** @type {unknown} */ error) =>
                    console.error("[Sidebar] reveal failed:", error),
                  ),
            },
          ]
        : []),
      {
        label: t("files.copyPath"),
        action: () => void copyText(projectPath).catch(() => {}),
      },
      {
        label: t("sidebar.renameProject"),
        action: () => this.#startProjectRename(/** @type {SidebarProject} */ (project)),
      },
      { separator: true },
      {
        label: t("sidebar.archiveWorkspaceSessions"),
        action: () => this.archiveProject(/** @type {SidebarProject} */ (project)),
      },
      { separator: true },
      {
        label: isWorkspacePinned ? t("sidebar.unpinWorkspace") : t("sidebar.pinWorkspace"),
        action: () => {
          if (isWorkspacePinned) {
            this.pinnedStore.unpinWorkspace(projectPath);
          } else {
            this.pinnedStore.pinWorkspace(projectPath, projectPath);
          }
          this.render();
        },
      },
      { separator: true },
      {
        label: t("sidebar.closeProject"),
        action: () => void this.#closeProject(/** @type {SidebarProject} */ (project)),
      },
      {
        label: t("sidebar.deleteWorkspaceSessions"),
        action: () => this.deleteWorkspaceSessions(project),
      },
    ];
    if (!this.chatReports?.get(projectPath)?.insideProject) {
      rows.splice(rows.length - 1, 0, {
        label: t("sidebar.keepChats"),
        action: () => void this.keepChats(/** @type {SidebarProject} */ (project)),
      });
    }
    this.#showMenu(event, rows);
  }

  /**
   * @param {MouseEvent} event
   * @param {ContextMenuRow[]} rows
   */
  #showMenu(event, rows) {
    showContextMenu({ event, items: rows });
  }

  closeContextMenu() {
    closeContextMenu();
  }

  /**
   * @param {string} sessionId
   * @param {string} name
   */
  setSessionName(sessionId, name) {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    session.name = name || "";
    const title = session.name || session.firstMessage || "Empty session";
    const titleEl = this.container.querySelector(
      `.session-item[data-session-id="${cssEscape(sessionId)}"] .session-title`,
    );
    if (!(titleEl instanceof HTMLElement)) return;
    titleEl.textContent = title;
    titleEl.title = title;
  }

  async #duplicateSession() {
    const target = this.getTarget();
    const result = rpcData(
      await this.runtime.request({ type: "clone" }, target, { idempotencyKey: randomId() }),
    );
    if (result.cancelled) return;
    const stats = rpcData(await this.runtime.request({ type: "get_session_stats" }, target));
    const nextId = stats.sessionId;
    if (typeof nextId !== "string" || !nextId || nextId === target?.sessionId) return;
    const rebound = await this.runtime.rebindSession?.(target, nextId);
    this.onSelect({
      id: rebound?.sessionId || nextId,
      isCurrentWorkspace: true,
    });
  }

  async #exportHtml() {
    await exportSessionHtml(this.runtime, this.getTarget(), this.control);
  }

  async #addLabel() {
    const entryId = currentTreeLeaf();
    const label = window.prompt(t("sidebar.addLabel"));
    if (!entryId || !label?.trim() || !this.config) return;
    await this.config.call("set_label", { entryId, label: label.trim() });
    await refreshSessionTree({
      runtime: this.runtime,
      getTarget: () => this.getTarget(),
    });
  }

  /**
   * @param {SidebarSession} session
   * @param {SidebarTarget | null | undefined} [target]
   */
  async #generateTitle(session, target = this.getTarget()) {
    if (!this.config) return false;
    const item = this.container.querySelector(
      `.session-item[data-session-id="${cssEscape(session.id ?? "")}"]`,
    );
    const titleElRaw = item?.querySelector(".session-title");
    const titleEl = titleElRaw instanceof HTMLElement ? titleElRaw : null;
    const previousTitle = titleEl?.textContent || session.name || "";
    if (titleEl) titleEl.textContent = t("sidebar.generatingTitle");

    try {
      const result = await this.config.call(
        "generate_session_title",
        {},
        { timeoutMs: 100_000, target },
      );
      const title = result?.data?.title?.trim();
      if (!result?.ok || !title) throw new Error(result?.error || t("sidebar.generateTitleError"));
      await this.runtime.request({ type: "set_session_name", name: title }, target, {
        idempotencyKey: randomId(),
      });
      session.name = title;
      if (titleEl) {
        titleEl.textContent = title;
        titleEl.title = title;
      }
      return true;
    } catch (error) {
      if (titleEl) titleEl.textContent = previousTitle;
      console.error("[Sidebar] Generate title failed:", error);
      return false;
    }
  }

  /** @param {SidebarSession} session */
  #startRename(session) {
    const item = this.container.querySelector(
      `.session-item[data-session-id="${cssEscape(session.id ?? "")}"]`,
    );
    const titleEl = item?.querySelector(".session-title");
    if (!(titleEl instanceof HTMLElement)) return;
    const current = titleEl.textContent;
    const input = document.createElement("input");
    input.className = "session-rename-input";
    input.value = current ?? "";
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
      const name = input.value.trim();
      if (name && name !== current) {
        try {
          if (session.id === this.activeSessionId) {
            await this.runtime.request({ type: "set_session_name", name }, this.getTarget(), {
              idempotencyKey: randomId(),
            });
          } else {
            const result = await this.config?.call("rename_historical_session", {
              filePath: session.filePath,
              name,
            });
            if (!result?.ok) throw new Error(result?.error || "Session rename failed");
          }
          for (const candidate of this.sessions) {
            if (candidate.filePath === session.filePath) candidate.name = name;
          }
          session.name = name;
          void this.load({ quiet: true });
        } catch (error) {
          console.error("[Sidebar] Rename failed:", error);
        }
      }
      const el = document.createElement("div");
      el.className = "session-title";
      el.title = name || current || "";
      el.textContent = name || current || "";
      input.replaceWith(el);
    };

    input.addEventListener("blur", commit);
    /** @param {KeyboardEvent} event */
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        input.value = current ?? "";
        input.blur();
      }
    });
  }

  /** @param {SidebarSession} session @param {{ showArchiveButton?: boolean, showPinButton?: boolean }} [options] */
  buildItem(session, options) {
    return this.#buildItem(session, options);
  }

  /** @param {string} className @param {string} innerHtml */
  sectionHeader(className, innerHtml) {
    return this.#sectionHeader(className, innerHtml);
  }

  /** @param {MouseEvent} event @param {{ path?: string, name?: string }} project */
  showProjectContextMenu(event, project) {
    return this.#showProjectContextMenu(event, project);
  }

  /** @param {unknown} error */
  #reportError(error) {
    console.error("[Sidebar] Project action failed:", error);
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  /**
   * The project's Pi process was stopped so its files could move. The open
   * session comes back in the project's new place; another project just
   * refreshes the list. After a failed move the page stays, so the error
   * stays on screen.
   * @param {SidebarProject} project
   * @param {{ failed?: boolean }} [options]
   */
  async #resumeAfterProjectMove(project, { failed = false } = {}) {
    this._chatReportsStale = true;
    const target = this.getTarget?.();
    if (project.isCurrent && target?.workspaceId && target?.sessionId) {
      await this.control?.restartRuntime?.(target.workspaceId, target.sessionId).catch(() => null);
      if (!failed) {
        window.location.reload();
        return;
      }
    }
    await this.load({ quiet: true });
  }

  /** @param {SidebarProject} project */
  async #closeProject(project) {
    const running = (project.sessions ?? []).some((session) => isWorkingSession(session));
    if (running) {
      const ok = await confirmDialog({ message: t("sidebar.closeWorking") });
      if (!ok) return;
    }
    try {
      await this.control?.closeProject?.(project.path);
    } catch (error) {
      this.#reportError(error);
      return;
    }
    rememberHiddenLocal(uiStore, "", project.path);
    this.pinnedStore?.unpinWorkspace?.(project.path);
    const next = this.sessions.find(
      (session) =>
        session.projectPath !== project.path &&
        !isHiddenPath(session.projectPath) &&
        !this.archived.includes(session.id ?? ""),
    );
    if (project.isCurrent) {
      if (next) this.onSelect(next);
      else window.location.assign("/app?list=1");
      return;
    }
    this.render();
  }

  /** @param {SidebarProject} project */
  #startProjectRename(project) {
    const nameEl = [...this.container.querySelectorAll(".project-name")].find(
      (el) => el.getAttribute("title") === project.path,
    );
    if (!(nameEl instanceof HTMLElement)) return;
    const current = nameEl.textContent ?? "";
    const input = document.createElement("input");
    input.className = "session-rename-input";
    input.value = current;
    input.setAttribute("aria-label", t("sidebar.renameProject"));
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    /**
     * @param {boolean} save
     */
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const name = save ? input.value.trim() : current;
      /** @param {string} label */
      const restore = (label) => {
        const el = document.createElement("span");
        el.className = "project-name";
        el.title = project.path;
        el.textContent = label;
        input.replaceWith(el);
      };
      if (!save || !name || name === current) {
        restore(current);
        return;
      }
      const outside = this.chatReports.get(project.path)?.inProjectsFolder !== true;
      if (outside) {
        const ok = await confirmDialog({
          title: t("sidebar.renameProject"),
          message: t("sidebar.renameOutside", { from: project.path, to: name }),
        });
        if (!ok) {
          restore(current);
          return;
        }
      }
      const running = (project.sessions ?? []).some((session) => isWorkingSession(session));
      if (running) {
        const ok = await confirmDialog({ message: t("sidebar.renameWorking") });
        if (!ok) {
          restore(current);
          return;
        }
      }
      try {
        const result = await this.control?.renameProject?.(project.path, name);
        restore(name);
        if (result?.worktreeWarning) {
          await confirmDialog({
            title: t("sidebar.renameProject"),
            message: result.worktreeWarning,
          });
        }
        await this.#resumeAfterProjectMove(project);
      } catch (error) {
        restore(current);
        this.#reportError(error);
        const target = this.getTarget?.();
        if (project.isCurrent && target?.workspaceId && target?.sessionId) {
          await this.control
            ?.restartRuntime?.(target.workspaceId, target.sessionId)
            .catch(() => null);
        }
      }
    };
    input.addEventListener("blur", () => {
      void finish(true);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finish(false);
      }
    });
  }

  /**
   * Ask which projects hold chats recorded at another folder.
   * One report per project path, cached so render stays synchronous.
   */
  async refreshChatReports() {
    if (!this.control?.projectChats) return;
    /** @type {string[]} */
    const paths = [];
    for (const session of this.sessions) {
      const path = session?.projectPath;
      if (typeof path === "string" && path !== "" && !isHiddenPath(path) && !paths.includes(path)) {
        paths.push(path);
      }
    }
    /** @type {Map<string, { foreign?: number, recordedAt?: string, recordedExists?: boolean, insideProject?: boolean, inProjectsFolder?: boolean }>} */
    const reports = new Map();
    await Promise.all(
      paths.map(async (path) => {
        const report = await this.control?.projectChats?.(path).catch(() => null);
        if (report) reports.set(path, report);
      }),
    );
    this.chatReports = reports;
  }

  /** @param {SidebarProject} project */
  async keepChats(project) {
    const ok = await confirmDialog({ message: t("sidebar.keepChatsConfirm") });
    if (!ok) return;
    let failed = false;
    try {
      await this.control?.keepChatsInProject?.(project.path);
    } catch (error) {
      failed = true;
      this.#reportError(error);
    }
    await this.#resumeAfterProjectMove(project, { failed });
  }

  /** @param {SidebarProject} project */
  async relinkProject(project) {
    let failed = false;
    try {
      await this.control?.relinkProject?.(project.path);
    } catch (error) {
      failed = true;
      this.#reportError(error);
    }
    await this.#resumeAfterProjectMove(project, { failed });
  }

  /** @param {...any} args @returns {any} */
  renderPinnedSection(...args) {
    return sidebarSections.renderPinnedSection.apply(this, args);
  }

  /** @param {...any} args @returns {any} */
  groupByProject(...args) {
    return sidebarSections.groupByProject.apply(this, args);
  }

  /** @param {...any} args @returns {any} */
  buildProjectGroup(...args) {
    return sidebarSections.buildProjectGroup.apply(this, args);
  }

  /** Stops the Pin subscription and sync so a replaced sidebar leaves no listeners. */
  destroy() {
    document.removeEventListener("click", this._onDocumentClick);
    try {
      this._unsubscribePinned?.();
    } catch (error) {
      console.error("[Sidebar] Pin unsubscribe failed:", error);
    }
    try {
      this._stopPinnedSync?.();
    } catch (error) {
      console.error("[Sidebar] Pin sync stop failed:", error);
    }
    try {
      this.pinnedStore?.destroy?.();
    } catch (error) {
      console.error("[Sidebar] Pin store destroy failed:", error);
    }
  }
}

Object.assign(SessionSidebar.prototype, sidebarSections);
