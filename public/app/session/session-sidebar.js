// ABOUTME: The SessionSidebar class: list state, preferences, status indicators, and its public API.
// ABOUTME: Loading, drawing, search, menus, rename, and archive live in session-sidebar-*.js mixins.

import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { closeContextMenu } from "../ui/context-menu.js";
import { createPinnedItemsStore, startPinnedItemsSync } from "./pinned-items.js";
import { sidebarArchive } from "./session-sidebar-archive.js";
import { sidebarLoad } from "./session-sidebar-load.js";
import { sidebarMenus } from "./session-sidebar-menus.js";
import {
  MAX_RECENT_SESSIONS,
  readArray,
  readObject,
  STORAGE,
  saveJson,
} from "./session-sidebar-prefs.js";
import { sidebarProjectActions } from "./session-sidebar-project-actions.js";
import { cssEscape } from "./session-sidebar-records.js";
import { sidebarRename } from "./session-sidebar-rename.js";
import { sidebarRender } from "./session-sidebar-render.js";
import { sidebarSearch } from "./session-sidebar-search.js";
import { sidebarSections } from "./session-sidebar-sections.js";

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
 * @property {string} [worktreeOf]
 */

/**
 * @typedef {object} SidebarProject
 * @property {string} path
 * @property {string} name
 * @property {boolean} [isCurrent]
 * @property {SidebarSession[]} [sessions]
 * @property {SidebarSession[]} [archivedSessions]
 * @property {string} [worktreeOf]
 * @property {SidebarProject[]} [worktrees]
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
 * @property {SidebarSession[]} [archivedSessions]
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
 *   createWorktree?: (path: string, branch: string) => Promise<{ projectPath?: string }>,
 *   mergeWorktree?: (path: string) => Promise<{ merged?: boolean, into?: string, conflicts?: string[] }>,
 *   removeWorktree?: (path: string, options?: { force?: boolean }) => Promise<{ primaryPath?: string }>,
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
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-label", t("nav.sessions"));
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
    saveJson(STORAGE.favourites, this.favourites);
    this.render();
  }
  /** @param {string} id */
  toggleArchived(id) {
    const idx = this.archived.indexOf(id);
    if (idx >= 0) this.archived.splice(idx, 1);
    else this.archived.push(id);
    saveJson(STORAGE.archived, this.archived);
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
    saveJson(STORAGE.recent, this.recent);
  }

  /** Mod+N: the same as the + on the open project's row. */
  newChatInCurrentProject() {
    const button = this.container.querySelector(
      ".project-group.current-project .project-new-chat-btn",
    );
    if (button instanceof HTMLElement) button.click();
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
      saveJson(STORAGE.unread, [...this.unread]);
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
      el.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        el.classList.remove("unread");
        el.setAttribute("aria-current", "true");
      } else {
        el.removeAttribute("aria-current");
      }
    });
  }
  /** @param {string | null | undefined} id */
  markUnread(id) {
    if (!id || id === this.activeSessionId || this.unread.has(id)) return;
    this.unread.add(id);
    saveJson(STORAGE.unread, [...this.unread]);
    this.#applyStatus(id);
  }
  /** @param {string | null | undefined} id */
  markRead(id) {
    if (!id || !this.unread.has(id)) return;
    this.unread.delete(id);
    saveJson(STORAGE.unread, [...this.unread]);
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

  closeContextMenu() {
    closeContextMenu();
  }

  // ── loading (session-sidebar-load.js) ──────────────────────────
  /** @param {Parameters<typeof sidebarLoad.load>} args */
  load(...args) {
    return sidebarLoad.load.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarLoad.upsertSession>} args */
  upsertSession(...args) {
    return sidebarLoad.upsertSession.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarLoad.refreshChatReports>} args */
  refreshChatReports(...args) {
    return sidebarLoad.refreshChatReports.apply(this, args);
  }

  // ── search (session-sidebar-search.js) ─────────────────────────
  /** @param {Parameters<typeof sidebarSearch.setSearchQuery>} args */
  setSearchQuery(...args) {
    return sidebarSearch.setSearchQuery.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarSearch.applySearch>} args */
  applySearch(...args) {
    return sidebarSearch.applySearch.apply(this, args);
  }

  // ── drawing (session-sidebar-render.js, session-sidebar-sections.js) ──
  /** @param {Parameters<typeof sidebarRender.render>} args */
  render(...args) {
    return sidebarRender.render.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarRender.buildItem>} args */
  buildItem(...args) {
    return sidebarRender.buildItem.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarRender.sectionHeader>} args */
  sectionHeader(...args) {
    return sidebarRender.sectionHeader.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarSections.renderPinnedSection>} args */
  renderPinnedSection(...args) {
    return sidebarSections.renderPinnedSection.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarSections.groupByProject>} args */
  groupByProject(...args) {
    return sidebarSections.groupByProject.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarSections.buildProjectGroup>} args */
  buildProjectGroup(...args) {
    return sidebarSections.buildProjectGroup.apply(this, args);
  }

  // ── menus, rename, archive, project moves ──────────────────────
  /** @param {Parameters<typeof sidebarMenus.showProjectContextMenu>} args */
  showProjectContextMenu(...args) {
    return sidebarMenus.showProjectContextMenu.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarRename.setSessionName>} args */
  setSessionName(...args) {
    return sidebarRename.setSessionName.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarArchive.archiveProject>} args */
  archiveProject(...args) {
    return sidebarArchive.archiveProject.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarArchive.deleteWorkspaceSessions>} args */
  deleteWorkspaceSessions(...args) {
    return sidebarArchive.deleteWorkspaceSessions.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarArchive.deleteAllArchived>} args */
  deleteAllArchived(...args) {
    return sidebarArchive.deleteAllArchived.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarProjectActions.keepChats>} args */
  keepChats(...args) {
    return sidebarProjectActions.keepChats.apply(this, args);
  }

  /** @param {Parameters<typeof sidebarProjectActions.relinkProject>} args */
  relinkProject(...args) {
    return sidebarProjectActions.relinkProject.apply(this, args);
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
