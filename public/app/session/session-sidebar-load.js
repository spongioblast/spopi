// ABOUTME: Loads the session sidebar's list from the host, with cache first paint, retries, and upserts.
// ABOUTME: It also fills live statuses and chat reports; drawing the list is session-sidebar-render.js.

import { basenameLocalPath } from "../files/path-utils.js";
import { t } from "../i18n/i18n.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { isHiddenPath } from "./missing-workspace.js";
import { readSessionCache, writeSessionCache } from "./session-list-cache.js";
import { STORAGE, saveJson } from "./session-sidebar-prefs.js";
import {
  hasLiveStatus,
  isUnreadSession,
  isWorkingSession,
  mergeSessionSummary,
  sessionListSignature,
} from "./session-sidebar-records.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 */

const LOAD_RETRY_DELAYS_MS = [250, 750, 1500];

/** @param {SessionSidebar} sidebar */
export function currentOpenProject(sidebar) {
  const workspaceId = sidebar.getTarget()?.workspaceId;
  return workspaceId && sidebar.openProject?.workspaceId === workspaceId
    ? sidebar.openProject
    : null;
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarSession[]} sessions
 * @param {{ authoritative?: boolean }} [options]
 */
function hydrateStatuses(sidebar, sessions, { authoritative = false } = {}) {
  const listedIds = new Set();
  for (const session of sessions) {
    if (!session?.id) continue;
    listedIds.add(session.id);
    if (isWorkingSession(session)) sidebar.streaming.add(session.id);
    else if (authoritative || hasLiveStatus(session)) sidebar.streaming.delete(session.id);

    if (isUnreadSession(session) && session.id !== sidebar.activeSessionId)
      sidebar.unread.add(session.id);
    else if (session.id === sidebar.activeSessionId) sidebar.unread.delete(session.id);
  }
  if (authoritative) {
    for (const id of sidebar.streaming) {
      if (!listedIds.has(id)) sidebar.streaming.delete(id);
    }
  }
  saveJson(STORAGE.unread, [...sidebar.unread]);
}

/**
 * With no other session of the open project in the list (a fresh start, or
 * right after deleting them all) the workspace id stood in for the folder, so
 * the session grouped under a separate "Current project". Ask the host for
 * the real folder and move it under that project.
 * @param {SessionSidebar} sidebar
 * @param {string | undefined} sessionId
 */
async function fillProjectPath(sidebar, sessionId) {
  const workspaceId = sidebar.getTarget()?.workspaceId;
  if (!workspaceId || !sidebar.data?.workspaceInfo) return;
  try {
    const frame = /** @type {{ info?: { path?: string }, path?: string } | null} */ (
      await sidebar.data.workspaceInfo(workspaceId)
    );
    const path = frame?.info?.path ?? frame?.path ?? "";
    if (!path) return;
    const session = sidebar.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || session.projectPath !== workspaceId) return;
    session.projectPath = path;
    session.projectName = basenameLocalPath(path) || path;
    writeSessionCache(workspaceId, sidebar.sessions);
    sidebar.render();
  } catch {
    // The placeholder group stays until the next load corrects it.
  }
}

/** @param {SessionSidebar} sidebar */
async function loadOpenProject(sidebar) {
  const workspaceId = sidebar.getTarget()?.workspaceId;
  if (!workspaceId || sidebar.cacheScope === "launcher" || !sidebar.data?.workspaceInfo) return;
  if (currentOpenProject(sidebar)) return;
  try {
    const frame =
      /** @type {{ info?: { path?: string, isGit?: boolean, worktreeOf?: string, branch?: string }, path?: string, isGit?: boolean, worktreeOf?: string, branch?: string } | null} */ (
        await sidebar.data.workspaceInfo(workspaceId)
      );
    const info = frame?.info ?? frame;
    const path = info?.path ?? "";
    if (!path || sidebar.getTarget()?.workspaceId !== workspaceId) return;
    sidebar.openProject = {
      workspaceId,
      projectPath: path,
      projectName: basenameLocalPath(path) || path,
      isGit: info?.isGit === true,
      worktreeOf: typeof info?.worktreeOf === "string" ? info.worktreeOf : "",
      branch: typeof info?.branch === "string" ? info.branch : "",
    };
    if (!sidebar.sessions.some((session) => session.isCurrentWorkspace)) sidebar.render();
  } catch {
    // Without the folder the open project shows once its first chat is saved.
  }
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarLoad = /** @satisfies {ThisType<SessionSidebar>} */ ({
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
        hydrateStatuses(this, this.sessions);
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
          skelTitle.className = "ui-skeleton session-skeleton-title";
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
      hydrateStatuses(this, this.sessions, { authoritative: true });
      writeSessionCache(workspaceId, this.sessions);
      this.onSessionsLoaded?.(this.sessions);
      if (changed || reportsChanged || (!quiet && !renderedFromCache)) this.render();
      void loadOpenProject(this);
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
  },

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
        currentOpenProject(this) ??
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
    hydrateStatuses(this, this.sessions);
    writeSessionCache(this.getTarget()?.workspaceId, this.sessions);
    this.onSessionsLoaded?.(this.sessions);
    this.render();
    if (!projectFallback.projectPath) void fillProjectPath(this, next.id);
  },

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
  },
});
