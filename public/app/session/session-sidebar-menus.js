// ABOUTME: Right-click and "more actions" menus for session rows and project headers in the sidebar.
// ABOUTME: Rows call into rename, archive, and project actions; session-menu.js builds the session rows.

import { t } from "../i18n/i18n.js";
import { copyText } from "../ui/clipboard.js";
import { showContextMenu } from "../ui/context-menu.js";
import { promptDialog } from "../ui/dialog.js";
import { randomId } from "../utils/random-id.js";
import { createWorktreeFlow } from "../worktree/worktree-actions.js";
import { pathKey } from "../worktree/worktree-model.js";
import { exportSessionHtml } from "./session-export.js";
import { sessionMenuRows } from "./session-menu.js";
import { closeProject, startProjectRename } from "./session-sidebar-project-actions.js";
import { generateTitle, startRename } from "./session-sidebar-rename.js";
import { startSessionIn } from "./session-sidebar-sections.js";
import { currentTreeLeaf, refreshSessionTree } from "./session-tree-host.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 * @typedef {import("./session-sidebar.js").SidebarProject} SidebarProject
 * @typedef {import("./session-sidebar.js").ContextMenuRow} ContextMenuRow
 */

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

/** @param {SessionSidebar} sidebar */
async function duplicateSession(sidebar) {
  const target = sidebar.getTarget();
  const result = rpcData(
    await sidebar.runtime.request({ type: "clone" }, target, { idempotencyKey: randomId() }),
  );
  if (result.cancelled) return;
  const stats = rpcData(await sidebar.runtime.request({ type: "get_session_stats" }, target));
  const nextId = stats.sessionId;
  if (typeof nextId !== "string" || !nextId || nextId === target?.sessionId) return;
  const rebound = await sidebar.runtime.rebindSession?.(target, nextId);
  sidebar.onSelect({
    id: rebound?.sessionId || nextId,
    isCurrentWorkspace: true,
  });
}

/** @param {SessionSidebar} sidebar */
async function exportHtml(sidebar) {
  await exportSessionHtml(sidebar.runtime, sidebar.getTarget(), sidebar.control);
}

/** @param {SessionSidebar} sidebar */
async function addLabel(sidebar) {
  const entryId = currentTreeLeaf();
  const label = await promptDialog({ title: t("sidebar.addLabel") });
  if (!entryId || !label || !sidebar.config) return;
  await sidebar.config.call("set_label", { entryId, label: label.trim() });
  await refreshSessionTree({
    runtime: sidebar.runtime,
    getTarget: () => sidebar.getTarget(),
  });
}

/**
 * @param {SessionSidebar} sidebar
 * @param {MouseEvent} event
 * @param {SidebarSession} session
 */
export function showSessionContextMenu(sidebar, event, session) {
  event.preventDefault();
  showContextMenu({
    event,
    items: sessionMenuRows(session, {
      activeSessionId: sidebar.activeSessionId,
      isFavourite: (id) => sidebar.isFavourite(id),
      toggleFavourite: (id) => sidebar.toggleFavourite(id),
      isArchived: (id) => sidebar.isArchived(id),
      toggleArchived: (id) => sidebar.toggleArchived(id),
      isSessionPinned: (id) => sidebar.pinnedStore?.isSessionPinned(id) ?? false,
      isWorkspacePinned: (path) => sidebar.pinnedStore?.isWorkspacePinned(path) ?? false,
      pinSession: (id) => sidebar.pinnedStore.pinSession(id),
      unpinSession: (id) => sidebar.pinnedStore.unpinSession(id),
      render: () => sidebar.render(),
      generateTitle: (item) => void generateTitle(sidebar, /** @type {SidebarSession} */ (item)),
      startRename: (item) => startRename(sidebar, /** @type {SidebarSession} */ (item)),
      duplicateSession: () => void duplicateSession(sidebar),
      addLabel: () => void addLabel(sidebar),
      exportHtml: () => void exportHtml(sidebar),
    }),
  });
}

/**
 * New worktree is only on the open project, and only when that project is a
 * git checkout that is not itself a linked worktree.
 * @param {SessionSidebar} sidebar
 * @param {string} projectPath
 * @param {boolean} isOpen
 */
function canStartWorktree(sidebar, projectPath, isOpen) {
  const open = sidebar.openProject;
  if (!isOpen || !open?.isGit || open.worktreeOf) return false;
  return pathKey(open.projectPath) === pathKey(projectPath);
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarMenus = /** @satisfies {ThisType<SessionSidebar>} */ ({
  /**
   * @param {MouseEvent} event
   * @param {SidebarProject | { path?: string, name?: string }} project
   */
  showProjectContextMenu(event, project) {
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
        action: () => startProjectRename(this, /** @type {SidebarProject} */ (project)),
      },
      ...(canStartWorktree(this, projectPath, isOpen)
        ? [
            {
              label: t("sidebar.newWorktree"),
              action: () =>
                void createWorktreeFlow(
                  this,
                  /** @type {SidebarProject} */ (project),
                  startSessionIn,
                ),
            },
          ]
        : []),
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
        action: () => void closeProject(this, /** @type {SidebarProject} */ (project)),
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
    showContextMenu({ event, items: rows });
  },
});
