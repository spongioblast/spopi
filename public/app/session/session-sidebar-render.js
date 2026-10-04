// ABOUTME: Draws the session sidebar: the Recent, Pinned, and Projects sections and each session row.
// ABOUTME: Rows carry their buttons and keyboard handling; menus, rename, and grouping live in sibling files.

import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { registerContextMenuHost } from "../ui/context-menu.js";
import { createIcon } from "../ui/icons.js";
import { nestWorktreeProjects } from "../worktree/worktree-model.js";
import { isHiddenPath, syncHiddenFromStore } from "./missing-workspace.js";
import { currentOpenProject } from "./session-sidebar-load.js";
import { showSessionContextMenu } from "./session-sidebar-menus.js";
import { STORAGE, saveJson, writeStorage } from "./session-sidebar-prefs.js";
import { startRename } from "./session-sidebar-rename.js";
import { placeOpenProject } from "./sidebar-open-project.js";
import { buildSidebarSection } from "./sidebar-workspace-group.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 * @typedef {import("./session-sidebar.js").PinState} PinState
 */

// Join the stored recent ids against the loaded session list, dropping ids
// that no longer resolve to a visible (non-archived) session. The prune is
// lazy: we only rewrite storage when the set actually shrank, avoiding
// write churn on every render.
/**
 * @param {SessionSidebar} sidebar
 * @returns {SidebarSession[]}
 */
function resolveRecentSessions(sidebar) {
  if (sidebar.recent.length === 0) return [];
  const byId = new Map(sidebar.sessions.map((session) => [session.id, session]));
  const resolved = sidebar.recent
    .map((id) => byId.get(id))
    .filter(
      /** @returns {session is SidebarSession} */
      (session) => Boolean(session?.id && !sidebar.isArchived(session.id)),
    );
  const validIds = resolved.map((session) => session.id).filter(Boolean);
  if (JSON.stringify(validIds) !== JSON.stringify(sidebar.recent)) {
    sidebar.recent = /** @type {string[]} */ (validIds);
    saveJson(STORAGE.recent, sidebar.recent);
  }
  return resolved;
}

/**
 * @param {SessionSidebar} sidebar
 * @param {HTMLElement} item
 * @param {{ selected?: boolean, status?: string, onActivate: () => void }} options
 */
export function decorateSessionItem(sidebar, item, { selected = false, status = "", onActivate }) {
  // Rows hold pin, rename, and archive buttons, so they cannot be listbox options.
  if (selected) item.setAttribute("aria-current", "true");
  item.tabIndex = selected ? 0 : -1;
  if (status) {
    const cue = document.createElement("span");
    cue.className = "sr-only";
    cue.textContent = status;
    item.prepend(cue);
  }
  item.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    onActivate();
  });
  item.addEventListener("keydown", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button") &&
      event.target !== item
    ) {
      if (event.key === "Enter" || event.key === " ") return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSessionFocus(sidebar, item, event.key === "ArrowDown" ? 1 : -1);
    }
  });
}

/**
 * @param {SessionSidebar} sidebar
 * @param {HTMLElement} item
 * @param {number} delta
 */
function moveSessionFocus(sidebar, item, delta) {
  const items = [...sidebar.container.querySelectorAll(".session-item:not(.hidden)")].filter(
    (node) => node instanceof HTMLElement,
  );
  const index = items.indexOf(item);
  if (index < 0) return;
  const next = items[(index + delta + items.length) % items.length];
  for (const row of items) row.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarRender = /** @satisfies {ThisType<SessionSidebar>} */ ({
  render() {
    syncHiddenFromStore(uiStore);
    this.container.replaceChildren();

    const pinState = /** @type {PinState} */ (this.pinnedStore.getState());
    const hasAnyPins = pinState.workspaces.length > 0 || pinState.sessions.length > 0;

    if (this.sessions.length === 0 && !hasAnyPins && !currentOpenProject(this)) {
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
    const recentSessions = resolveRecentSessions(this);
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
            body.appendChild(this.buildItem(session));
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
        worktreeOf: sessions[0]?.worktreeOf || "",
        sessions: [],
        archivedSessions: sessions,
      });
    }
    placeOpenProject(projects, currentOpenProject(this), pinnedWorkspacePaths);
    const listed = nestWorktreeProjects(projects);
    if (listed.length > 0) {
      const { section: projectsSection } = buildSidebarSection({
        region: "projects",
        titleKey: "sidebar.projects",
        count: listed.length,
        expanded: true,
        /** @param {HTMLElement} body */
        renderSessions: (body) => {
          for (const project of listed) {
            body.appendChild(this.buildProjectGroup(project));
          }
        },
      });
      projectsSection.classList.add("projects-group");
      this.container.appendChild(projectsSection);
    }

    if (this.searchQuery) this.applySearch();
  },

  // Built with the DOM API so all workspace-supplied text stays inert.
  /**
   * @param {SidebarSession} session
   * @param {{ showArchiveButton?: boolean, showPinButton?: boolean }} [options]
   */
  buildItem(session, { showArchiveButton = true, showPinButton = true } = {}) {
    const item = document.createElement("div");
    item.className = "session-item";
    item.dataset.sessionId = session.id;
    if (session.id === this.activeSessionId) item.classList.add("active");
    if (this.unread.has(session.id)) item.classList.add("unread");
    if (this.streaming.has(session.id)) item.classList.add("streaming", "mirror-live");
    decorateSessionItem(this, item, {
      selected: session.id === this.activeSessionId,
      status: this.streaming.has(session.id)
        ? t("sidebar.statusStreaming")
        : this.unread.has(session.id)
          ? t("sidebar.statusUnread")
          : "",
      onActivate: () => this.onSelect(session),
    });

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

    item.addEventListener("contextmenu", (event) =>
      showSessionContextMenu(this, /** @type {MouseEvent} */ (event), session),
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
        startRename(this, session);
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
  },

  /**
   * Header from markup whose workspace text the caller has already escaped.
   * @param {string} className
   * @param {string} innerHtml
   */
  sectionHeader(className, innerHtml) {
    const header = document.createElement("div");
    header.className = `project-header ${className}`;
    // DOMParser keeps any script in the markup inert.
    const doc = new DOMParser().parseFromString(innerHtml, "text/html");
    header.append(...doc.body.childNodes);
    return header;
  },
});
