// ABOUTME: Pinned rows and project groups for the session sidebar.
// ABOUTME: The sidebar class still owns the session list and context menus.

import { t } from "../i18n/i18n.js";
import { registerContextMenuHost } from "../ui/context-menu.js";
import { createIcon } from "../ui/icons.js";
import { escapeHtml } from "../ui/sanitize-markup.js";
import { isHiddenPath, isMissingPath } from "./missing-workspace.js";
import {
  INITIAL_LIMIT,
  STEP,
  STORAGE,
  tauriGlobal,
  workspaceFolderName,
  writeStorage,
} from "./session-sidebar.js";
import { buildSidebarSection, buildSidebarWorkspaceGroup } from "./sidebar-workspace-group.js";

/**
 * @typedef {any} SidebarSession
 * @typedef {any} SidebarProject
 * @typedef {any} PinnedGroup
 */

/** @type {any} */
export const sidebarSections = {
  /**
   * The desktop app opens the project's window natively; elsewhere the host
   * HTTP API starts the session, registering another project first.
   * @param {{ path?: string, isCurrent?: boolean }} project
   */
  canStartSessionIn(project) {
    const invoke = tauriGlobal().__TAURI__?.core?.invoke ?? null;
    if (invoke) return Boolean(project.path);
    if (project.isCurrent) return Boolean(this.onCreateSession);
    return Boolean(project.path && this.onCreateSessionInProject);
  },

  /**
   * Pi writes a session file only after the first message, so a just-started
   * session has no row of its own yet. This marks it so "+" visibly did something.
   * @param {string} sessionId
   */
  unsavedSessionRow(sessionId) {
    const item = document.createElement("div");
    item.className = "session-item active session-item-unsaved";
    item.dataset.sessionId = sessionId;
    item.title = t("sidebar.unsavedSessionHint");
    const titleRow = document.createElement("div");
    titleRow.className = "session-title-row";
    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = t("sidebar.unsavedSession");
    titleRow.appendChild(title);
    item.appendChild(titleRow);
    return item;
  },

  /** @param {{ path?: string, isCurrent?: boolean }} project */
  startSessionIn(project) {
    const invoke = tauriGlobal().__TAURI__?.core?.invoke ?? null;
    const started = invoke
      ? invoke("open_new_session_in_workspace", { projectPath: project.path })
      : project.isCurrent
        ? this.onCreateSession?.(this.getTarget()?.workspaceId)
        : this.onCreateSessionInProject?.(project.path);
    Promise.resolve(started).catch((/** @type {unknown} */ error) => {
      console.error("[Sidebar] Failed to start a new session:", error);
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  },

  /** @param {any} pinState */
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
      const session = this.sessions.find((/** @type {any} */ s) => s.id === id);
      if (!session || (session.id && this.isArchived(session.id))) {
        pinnedGroups.push({
          workspacePin: false,
          unavailable: true,
          workspace: null,
          sessions: [{ id }],
        });
      } else if (
        !pinState.workspaces.some((/** @type {any} */ w) => w.path === session.projectPath)
      ) {
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
            ws && !pinned.unavailable && this.canStartSessionIn(target),
          );
          const { group } = buildSidebarWorkspaceGroup({
            workspaceId,
            folderName: ws?.folderName || t("sidebar.unavailable"),
            workspacePath: ws?.path || "",
            sessionCount: pinned.sessions.length,
            expanded: true,
            onNewChat: canCreateSession ? () => this.startSessionIn(target) : undefined,
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
              const visibleCount = this.projectVisibleCount(project, pinned.sessions.length);
              const visible = this.searchQuery
                ? pinned.sessions
                : pinned.sessions.slice(0, visibleCount);
              for (const session of visible) {
                container.appendChild(this.buildItem(session));
              }
              if (!this.searchQuery) {
                const toggle = this.buildToggleRow(project, visible.length, pinned.sessions.length);
                if (toggle) container.appendChild(toggle);
              }
              this.appendArchivedRow(container, project.path, pinned.archivedSessions);
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
  isProjectCollapsed(project) {
    const stored = this.projectsCollapsed[project.path];
    // Default: current project expanded, all other projects collapsed. The /app?list page
    // has no current project, so there every project starts open and its sessions show.
    if (stored !== undefined) return stored === true;
    return this.cacheScope === "launcher" ? false : !project.isCurrent;
  },

  /**
   * Chats recorded at another folder get a note with a link action.
   * @param {HTMLElement} list
   * @param {SidebarProject} project
   */
  attachRelinkNote(list, project) {
    const report = this.chatReports?.get(project.path);
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
      void this.relinkProject?.(project);
    });
    note.append(text, link);
    list.prepend(note);
  },

  /**
   * A collapsed row of this project's archived chats.
   * @param {HTMLElement} list
   * @param {string} path
   * @param {SidebarSession[] | undefined} sessions
   */
  appendArchivedRow(list, path, sessions) {
    if (!sessions?.length) return;
    const open = this.searchQuery ? true : this.archivedOpen?.[path] === true;
    const row = document.createElement("div");
    row.className = "project-archived-row";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "project-archived-toggle";
    toggle.textContent = t("sidebar.archivedCount", { count: sessions.length });
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      this.archivedOpen[path] = !this.archivedOpen?.[path];
      writeStorage(STORAGE.archivedOpen, JSON.stringify(this.archivedOpen));
      this.render();
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
      void this.deleteAllArchived(ids);
    });
    row.append(toggle, remove);
    list.appendChild(row);
    if (!open) return;
    for (const session of sessions) {
      const item = this.buildItem(session, { showArchiveButton: false });
      item.classList.add("session-item-archived");
      list.appendChild(item);
    }
  },

  /** @param {SidebarProject} project */
  buildProjectGroup(project) {
    const group = document.createElement("div");
    group.className = `project-group${project.isCurrent ? " current-project" : ""}`;
    if (isMissingPath(project.path)) group.classList.add("project-missing");
    const collapsed = this.isProjectCollapsed(project);

    const newChatButtonHtml = this.canStartSessionIn(project)
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

    header
      .querySelector(".project-new-chat-btn")
      ?.addEventListener("click", (/** @type {MouseEvent} */ event) => {
        event.stopPropagation();
        this.startSessionIn(project);
      });

    const moreActionsEl = header.querySelector(".workspace-more-actions-btn");
    if (moreActionsEl) {
      const moreIcon = createIcon("ellipsis", { size: 14 });
      if (moreIcon) moreActionsEl.replaceChildren(moreIcon);
      moreActionsEl.addEventListener("click", (/** @type {MouseEvent} */ event) => {
        event.stopPropagation();
        this.showProjectContextMenu(/** @type {MouseEvent} */ (event), project);
      });
    }

    const list = document.createElement("div");
    list.className = `project-sessions${collapsed ? " collapsed" : ""}`;
    this.attachRelinkNote(list, project);

    const projectSessions = project.sessions ?? [];
    const visibleCount = this.projectVisibleCount(project, projectSessions.length);
    const visible = this.searchQuery ? projectSessions : projectSessions.slice(0, visibleCount);
    const active = this.activeSessionId;
    if (
      project.isCurrent &&
      !this.searchQuery &&
      typeof active === "string" &&
      this.isUnsavedSession(active) &&
      !projectSessions.some((/** @type {any} */ session) => session.id === active)
    ) {
      list.appendChild(this.unsavedSessionRow(active));
    }
    visible.forEach((/** @type {any} */ session) => {
      list.appendChild(this.buildItem(session));
    });
    if (!this.searchQuery) {
      const toggle = this.buildToggleRow(project, visible.length, projectSessions.length);
      if (toggle) list.appendChild(toggle);
    }
    this.appendArchivedRow(list, project.path, project.archivedSessions);

    const toggleCollapsed = () => {
      const next = !this.isProjectCollapsed(project);
      this.projectsCollapsed[project.path] = next;
      writeStorage(STORAGE.projectsCollapsed, JSON.stringify(this.projectsCollapsed));
      header.classList.toggle("collapsed", next);
      list.classList.toggle("collapsed", next);
      header.setAttribute("aria-expanded", String(!next));
    };
    header.setAttribute("role", "button");
    header.tabIndex = 0;
    header.setAttribute("aria-expanded", String(!collapsed));
    header.addEventListener("click", toggleCollapsed);
    header.addEventListener("keydown", (/** @type {KeyboardEvent} */ event) => {
      if (event.target !== header || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      toggleCollapsed();
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

  /** @param {SidebarProject | { path?: string, name?: string }} project */
  projectVisibleKey(project) {
    return project.path || project.name || "unknown";
  },

  /**
   * @param {SidebarProject | { path?: string, name?: string }} project
   * @param {number} totalCount
   */
  projectVisibleCount(project, totalCount) {
    const stored = this._visibleCountsByProject.get(this.projectVisibleKey(project));
    if (typeof stored === "number" && Number.isFinite(stored)) {
      return Math.max(INITIAL_LIMIT, Math.min(totalCount, Math.floor(stored)));
    }
    return Math.min(totalCount, INITIAL_LIMIT);
  },

  /**
   * @param {SidebarProject | { path?: string, name?: string }} project
   * @param {number} count
   */
  setProjectVisibleCount(project, count) {
    this._visibleCountsByProject.set(
      this.projectVisibleKey(project),
      Math.max(INITIAL_LIMIT, count),
    );
  },

  /**
   * @param {SidebarProject | { path?: string, name?: string }} project
   * @param {number} visibleCount
   * @param {number} totalCount
   */
  buildToggleRow(project, visibleCount, totalCount) {
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
        this.setProjectVisibleCount(project, visibleCount + STEP);
        this.render();
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
        this.setProjectVisibleCount(project, Math.max(INITIAL_LIMIT, visibleCount - STEP));
        this.render();
      });
      row.appendChild(less);
    }
    return row;
  },
};
