// ABOUTME: Pinned rows and project groups for the session sidebar, with their show-more and archived rows.
// ABOUTME: session-sidebar-render.js places these sections; row building and menus live in sibling files.

import { t } from "../i18n/i18n.js";
import { registerContextMenuHost } from "../ui/context-menu.js";
import { createIcon } from "../ui/icons.js";
import { escapeHtml } from "../ui/sanitize-markup.js";
import { isHiddenPath, isMissingPath } from "./missing-workspace.js";
import { INITIAL_LIMIT, STEP, STORAGE, writeStorage } from "./session-sidebar-prefs.js";
import { workspaceFolderName } from "./session-sidebar-records.js";
import {
  buildSidebarSection,
  buildSidebarWorkspaceGroup,
  mountDisclosure,
} from "./sidebar-workspace-group.js";
import { buildWorktreeGroups } from "./sidebar-worktree-group.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 * @typedef {import("./session-sidebar.js").SidebarProject} SidebarProject
 * @typedef {import("./session-sidebar.js").PinnedGroup} PinnedGroup
 * @typedef {import("./session-sidebar.js").PinState} PinState
 * @typedef {SidebarProject | { path?: string, name?: string }} ProjectRef
 */

/**
 * @returns {{ __TAURI__?: { core?: { invoke?: (...args: unknown[]) => Promise<unknown> } } }}
 */
function tauriGlobal() {
  return /** @type {{ __TAURI__?: { core?: { invoke?: (...args: unknown[]) => Promise<unknown> } } }} */ (
    globalThis
  );
}

/**
 * The desktop app opens the project's window natively; elsewhere the host
 * HTTP API starts the session, registering another project first.
 * @param {SessionSidebar} sidebar
 * @param {{ path?: string, isCurrent?: boolean }} project
 */
function canStartSessionIn(sidebar, project) {
  const invoke = tauriGlobal().__TAURI__?.core?.invoke ?? null;
  if (invoke) return Boolean(project.path);
  if (project.isCurrent) return Boolean(sidebar.onCreateSession);
  return Boolean(project.path && sidebar.onCreateSessionInProject);
}

/**
 * Pi writes a session file only after the first message, so a just-started
 * session has no row of its own yet. This marks it so "+" visibly did something.
 * @param {string} sessionId
 */
function unsavedSessionRow(sessionId) {
  const item = document.createElement("div");
  item.className = "session-item active session-item-unsaved";
  item.dataset.sessionId = sessionId;
  item.title = t("sidebar.unsavedSessionHint");
  item.setAttribute("aria-current", "true");
  item.tabIndex = 0;
  const titleRow = document.createElement("div");
  titleRow.className = "session-title-row";
  const title = document.createElement("div");
  title.className = "session-title";
  title.textContent = t("sidebar.unsavedSession");
  titleRow.appendChild(title);
  item.appendChild(titleRow);
  return item;
}

/**
 * @param {SessionSidebar} sidebar
 * @param {{ path?: string, isCurrent?: boolean }} project
 */
export function startSessionIn(sidebar, project) {
  const invoke = tauriGlobal().__TAURI__?.core?.invoke ?? null;
  const started = invoke
    ? invoke("open_new_session_in_workspace", { projectPath: project.path })
    : project.isCurrent
      ? sidebar.onCreateSession?.(sidebar.getTarget()?.workspaceId)
      : sidebar.onCreateSessionInProject?.(project.path ?? "");
  Promise.resolve(started).catch((/** @type {unknown} */ error) => {
    console.error("[Sidebar] Failed to start a new session:", error);
    sidebar.onError?.(error instanceof Error ? error : new Error(String(error)));
  });
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 */
function isProjectCollapsed(sidebar, project) {
  const stored = sidebar.projectsCollapsed[project.path];
  // Default: current project expanded, all other projects collapsed. The /app?list page
  // has no current project, so there every project starts open and its sessions show.
  if (stored !== undefined) return stored === true;
  if (project.worktrees?.some((worktree) => worktree.isCurrent)) return false;
  return sidebar.cacheScope === "launcher" ? false : !project.isCurrent;
}

/**
 * Chats recorded at another folder get a note with a link action.
 * @param {SessionSidebar} sidebar
 * @param {HTMLElement} list
 * @param {SidebarProject} project
 */
function attachRelinkNote(sidebar, list, project) {
  const report = sidebar.chatReports?.get(project.path);
  if (!report?.foreign) return;
  const note = document.createElement("div");
  note.className = "project-relink-note";
  const text = document.createElement("span");
  text.textContent = report.recordedExists
    ? t("sidebar.relinkCopy", { count: report.foreign, path: report.recordedAt })
    : t("sidebar.relinkMoved", { count: report.foreign, path: report.recordedAt });
  const link = document.createElement("button");
  link.type = "button";
  link.className = "project-relink-btn";
  link.textContent = t("sidebar.relinkAction");
  link.addEventListener("click", () => {
    void sidebar.relinkProject?.(project);
  });
  note.append(text, link);
  list.prepend(note);
}

/**
 * A collapsed row of this project's archived chats.
 * @param {SessionSidebar} sidebar
 * @param {HTMLElement} list
 * @param {string} path
 * @param {SidebarSession[] | undefined} sessions
 */
export function appendArchivedRow(sidebar, list, path, sessions) {
  if (!sessions?.length) return;
  const open = sidebar.searchQuery ? true : sidebar.archivedOpen?.[path] === true;
  const row = document.createElement("div");
  row.className = "project-archived-row";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "project-archived-toggle";
  toggle.textContent = t("sidebar.archivedCount", { count: sessions.length });
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    sidebar.archivedOpen[path] = !sidebar.archivedOpen?.[path];
    writeStorage(STORAGE.archivedOpen, JSON.stringify(sidebar.archivedOpen));
    sidebar.render();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "archived-delete-all-btn";
  const label = t("sidebar.deleteArchivedHere");
  remove.title = label;
  remove.setAttribute("aria-label", label);
  const icon = createIcon("trash-2", { size: 13 });
  if (icon) remove.replaceChildren(icon);
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    const ids = sessions.map((session) => session.id).filter((id) => typeof id === "string");
    void sidebar.deleteAllArchived(ids);
  });
  row.append(toggle, remove);
  list.appendChild(row);
  if (!open) return;
  for (const session of sessions) {
    const item = sidebar.buildItem(session, { showArchiveButton: false });
    item.classList.add("session-item-archived");
    list.appendChild(item);
  }
}

/** @param {ProjectRef} project */
function projectVisibleKey(project) {
  return project.path || project.name || "unknown";
}

/**
 * @param {SessionSidebar} sidebar
 * @param {ProjectRef} project
 * @param {number} totalCount
 */
function projectVisibleCount(sidebar, project, totalCount) {
  const stored = sidebar._visibleCountsByProject.get(projectVisibleKey(project));
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.max(INITIAL_LIMIT, Math.min(totalCount, Math.floor(stored)));
  }
  return Math.min(totalCount, INITIAL_LIMIT);
}

/**
 * @param {SessionSidebar} sidebar
 * @param {ProjectRef} project
 * @param {number} count
 */
function setProjectVisibleCount(sidebar, project, count) {
  sidebar._visibleCountsByProject.set(projectVisibleKey(project), Math.max(INITIAL_LIMIT, count));
}

/**
 * @param {SessionSidebar} sidebar
 * @param {ProjectRef} project
 * @param {number} visibleCount
 * @param {number} totalCount
 */
function buildToggleRow(sidebar, project, visibleCount, totalCount) {
  const hasMore = visibleCount < totalCount;
  const canShowLess = visibleCount > INITIAL_LIMIT;
  if (!hasMore && !canShowLess) return null;
  const row = document.createElement("div");
  row.className = "project-sessions-toggle-row";
  if (hasMore) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "project-sessions-toggle";
    more.textContent = t("sidebar.showMore");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      setProjectVisibleCount(sidebar, project, visibleCount + STEP);
      sidebar.render();
    });
    row.appendChild(more);
  }
  if (canShowLess) {
    const less = document.createElement("button");
    less.type = "button";
    less.className = "project-sessions-toggle project-sessions-toggle-less";
    less.textContent = t("sidebar.showLess");
    less.addEventListener("click", (event) => {
      event.stopPropagation();
      setProjectVisibleCount(sidebar, project, Math.max(INITIAL_LIMIT, visibleCount - STEP));
      sidebar.render();
    });
    row.appendChild(less);
  }
  return row;
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarSections = /** @satisfies {ThisType<SessionSidebar>} */ ({
  /** @param {PinState} pinState */
  renderPinnedSection(pinState) {
    // Resolve pinned workspaces: each gets its sessions from this.sessions.
    // Orphan workspace pins (no loaded sessions) render an Unavailable row
    // with an Unpin button.
    /** @type {Map<string, SidebarSession[]>} */
    const byPath = new Map();
    for (const session of this.sessions) {
      if (!session.projectPath) continue;
      if (!byPath.has(session.projectPath)) byPath.set(session.projectPath, []);
      byPath.get(session.projectPath)?.push(session);
    }

    /** @type {PinnedGroup[]} */
    const pinnedGroups = [];
    for (const ws of pinState.workspaces) {
      if (isHiddenPath(ws.path)) continue;
      const allSessions = byPath.get(ws.path || "") || [];
      const sessions = allSessions.filter((s) => s.id && !this.isArchived(s.id));
      const archivedSessions = allSessions.filter((s) => s.id && this.isArchived(s.id));
      pinnedGroups.push({
        workspacePin: true,
        unavailable: sessions.length === 0 && archivedSessions.length === 0,
        archivedSessions,
        workspace: {
          path: ws.path,
          folderName: workspaceFolderName(
            ws.path,
            sessions[0]?.projectName || archivedSessions[0]?.projectName,
          ),
        },
        sessions,
      });
    }
    // Orphan session pins (session.id in pinState.sessions but workspace not pinned).
    for (const id of pinState.sessions) {
      const session = this.sessions.find((/** @type {SidebarSession} */ s) => s.id === id);
      if (!session || (session.id && this.isArchived(session.id))) {
        pinnedGroups.push({
          workspacePin: false,
          unavailable: true,
          workspace: null,
          sessions: [{ id }],
        });
      } else if (!pinState.workspaces.some((w) => w.path === session.projectPath)) {
        pinnedGroups.push({
          workspacePin: false,
          unavailable: false,
          workspace: {
            path: session.projectPath ?? undefined,
            folderName: workspaceFolderName(session.projectPath, session.projectName),
          },
          sessions: [session],
        });
      }
    }

    if (pinnedGroups.length === 0) return;

    const { section } = buildSidebarSection({
      region: "pinned",
      titleKey: "sidebar.pinned",
      count: pinnedGroups.length,
      expanded: !this.pinnedCollapsed,
      /** @param {boolean} expanded */
      onToggle: (expanded) => {
        this.pinnedCollapsed = !expanded;
      },
      /** @param {HTMLElement} body */
      renderSessions: (body) => {
        for (const pinned of pinnedGroups) {
          const ws = pinned.workspace;
          const workspaceId = ws?.path || `pinned-session:${pinned.sessions[0]?.id || ""}`;
          const target = {
            path: ws?.path || "",
            isCurrent: pinned.sessions.some(
              (/** @type {SidebarSession} */ s) => s.isCurrentWorkspace,
            ),
          };
          const canCreateSession = Boolean(
            ws && !pinned.unavailable && canStartSessionIn(this, target),
          );
          const { group } = buildSidebarWorkspaceGroup({
            workspaceId,
            folderName: ws?.folderName || t("sidebar.unavailable"),
            workspacePath: ws?.path || "",
            sessionCount: pinned.sessions.length,
            expanded: true,
            onNewChat: canCreateSession ? () => startSessionIn(this, target) : undefined,
            onMoreActions: pinned.workspacePin
              ? /** @param {MouseEvent} event */
                (event) =>
                  this.showProjectContextMenu(event, {
                    path: ws?.path || "",
                    name: ws?.folderName || "",
                  })
              : undefined,
            /** @param {HTMLElement} container */
            renderSessions: (container) => {
              if (pinned.unavailable) {
                const unavailable = document.createElement("div");
                unavailable.className = "pinned-unavailable";
                unavailable.textContent =
                  ws?.path || pinned.sessions[0]?.id || t("sidebar.unavailable");
                container.appendChild(unavailable);
                const unpin = document.createElement("button");
                unpin.type = "button";
                unpin.textContent = pinned.workspacePin
                  ? t("sidebar.unpinWorkspace")
                  : t("sidebar.unpinSession");
                unpin.addEventListener("click", (event) => {
                  event.stopPropagation();
                  if (pinned.workspacePin) {
                    if (ws?.path) this.pinnedStore.unpinWorkspace(ws.path);
                  } else {
                    const orphanId = pinned.sessions[0]?.id;
                    if (orphanId) this.pinnedStore.unpinSession(orphanId);
                  }
                });
                container.appendChild(unpin);
                return;
              }
              const project = {
                path: ws?.path || workspaceId,
                name: ws?.folderName || workspaceId,
              };
              const visibleCount = projectVisibleCount(this, project, pinned.sessions.length);
              const visible = this.searchQuery
                ? pinned.sessions
                : pinned.sessions.slice(0, visibleCount);
              for (const session of visible) {
                container.appendChild(this.buildItem(session));
              }
              if (!this.searchQuery) {
                const toggle = buildToggleRow(
                  this,
                  project,
                  visible.length,
                  pinned.sessions.length,
                );
                if (toggle) container.appendChild(toggle);
              }
              appendArchivedRow(this, container, project.path, pinned.archivedSessions);
            },
          });
          group.classList.add("pinned-workspace-group");
          body.appendChild(group);
        }
      },
    });
    section.classList.add("pinned-group");
    this.container.appendChild(section);
  },

  // Group regular sessions by their originating project. The list arrives
  // sorted newest-first, so the first session from each project determines the
  // project's position without reordering projects around the active project.
  /**
   * @param {SidebarSession[]} sessions
   * @returns {SidebarProject[]}
   */
  groupByProject(sessions) {
    /** @type {string[]} */
    const order = [];
    /** @type {Map<string, SidebarProject>} */
    const byPath = new Map();
    for (const session of sessions) {
      const path = session.projectPath || "unknown";
      if (isHiddenPath(path)) continue;
      if (!byPath.has(path)) {
        byPath.set(path, {
          path,
          name: session.projectName || path,
          isCurrent: Boolean(session.isCurrentWorkspace),
          worktreeOf: session.worktreeOf || "",
          sessions: [],
        });
        order.push(path);
      }
      const group = byPath.get(path);
      if (!group) continue;
      group.sessions = group.sessions ?? [];
      group.sessions.push(session);
    }
    return order.map((path) => /** @type {SidebarProject} */ (byPath.get(path)));
  },

  /** @param {SidebarProject} project */
  buildProjectGroup(project) {
    const group = document.createElement("div");
    group.className = `project-group${project.isCurrent ? " current-project" : ""}`;
    if (isMissingPath(project.path)) group.classList.add("project-missing");
    const collapsed = isProjectCollapsed(this, project);

    const newChatButtonHtml = canStartSessionIn(this, project)
      ? `<button class="project-new-chat-btn" title="${escapeHtml(t("sidebar.newChat", { path: project.name }))}" aria-label="${escapeHtml(t("sidebar.newChat", { path: project.name }))}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>`
      : "";

    const moreActionsLabel = t("sidebar.workspaceActions");
    const moreActionsButtonHtml = `<button type="button" class="workspace-more-actions-btn" title="${escapeHtml(moreActionsLabel)}" aria-label="${escapeHtml(moreActionsLabel)}"></button>`;

    const header = this.sectionHeader(
      `project-group-header${collapsed ? " collapsed" : ""}`,
      `<span class="chevron folder-icon">
      <svg class="folder-closed-icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
      <svg class="folder-open-icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>
    </span>
    <span class="project-name" title="${escapeHtml(project.path)}">${escapeHtml(project.name)}</span>
    <span class="project-count">${(project.sessions?.length ?? 0) + (project.archivedSessions?.length ?? 0)}</span>
    ${newChatButtonHtml}
    ${moreActionsButtonHtml}`,
    );
    if (group.classList.contains("project-missing")) {
      const mark = createIcon("circle-info", { size: 14 });
      if (mark) header.prepend(mark);
      header.title = project.path;
    }

    header.querySelector(".project-new-chat-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      startSessionIn(this, project);
    });

    const moreActionsEl = header.querySelector(".workspace-more-actions-btn");
    if (moreActionsEl) {
      const moreIcon = createIcon("ellipsis", { size: 14 });
      if (moreIcon) moreActionsEl.replaceChildren(moreIcon);
      moreActionsEl.addEventListener("click", (event) => {
        event.stopPropagation();
        this.showProjectContextMenu(/** @type {MouseEvent} */ (event), project);
      });
    }

    const list = document.createElement("div");
    list.className = `project-sessions${collapsed ? " collapsed" : ""}`;
    attachRelinkNote(this, list, project);

    const projectSessions = project.sessions ?? [];
    const visibleCount = projectVisibleCount(this, project, projectSessions.length);
    const visible = this.searchQuery ? projectSessions : projectSessions.slice(0, visibleCount);
    const active = this.activeSessionId;
    if (
      project.isCurrent &&
      !this.searchQuery &&
      typeof active === "string" &&
      this.isUnsavedSession(active) &&
      !projectSessions.some((/** @type {SidebarSession} */ session) => session.id === active)
    ) {
      list.appendChild(unsavedSessionRow(active));
    }
    visible.forEach((/** @type {SidebarSession} */ session) => {
      list.appendChild(this.buildItem(session));
    });
    if (!this.searchQuery) {
      const toggle = buildToggleRow(this, project, visible.length, projectSessions.length);
      if (toggle) list.appendChild(toggle);
    }
    const worktrees = buildWorktreeGroups(this, project);
    if (worktrees) list.appendChild(worktrees);
    appendArchivedRow(this, list, project.path, project.archivedSessions);

    mountDisclosure(header, list, !collapsed, (open) => {
      this.projectsCollapsed[project.path] = !open;
      writeStorage(STORAGE.projectsCollapsed, JSON.stringify(this.projectsCollapsed));
    });
    header.addEventListener("contextmenu", (/** @type {MouseEvent} */ event) =>
      this.showProjectContextMenu(/** @type {MouseEvent} */ (event), project),
    );
    registerContextMenuHost(header);

    group.appendChild(header);
    group.appendChild(list);
    // Bind the workspace header to the hover quick-info card. Uses the
    // workspace's on-disk path as the stable identity since the native
    // arch has no separate `history:` id.
    return group;
  },
});
