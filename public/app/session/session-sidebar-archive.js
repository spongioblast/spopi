// ABOUTME: Archiving and deleting sidebar sessions: archive a project's chats, delete a workspace or archived ones.
// ABOUTME: Deletes are confirmed first. Ids leave local state when the host deleted them or they had no file.

import { t } from "../i18n/i18n.js";
import { confirmDialog } from "../ui/dialog.js";
import { STORAGE, saveJson } from "./session-sidebar-prefs.js";
import { reportProjectActionError } from "./session-sidebar-project-actions.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarProject} SidebarProject
 */

/**
 * The chat must not keep showing a conversation whose file is gone, so when
 * the open session is in `ids`, move to a fresh session in the same project
 * first. If that fails the open session is left out of the batch.
 * @param {SessionSidebar} sidebar
 * @param {string[]} ids
 * @returns {Promise<string[]>}
 */
async function leaveIfDeletingActive(sidebar, ids) {
  const active = sidebar.activeSessionId;
  if (!active || !ids.includes(active)) return ids;
  try {
    await sidebar.onCreateSession?.(sidebar.getTarget()?.workspaceId);
    return ids;
  } catch (error) {
    console.error("[Sidebar] could not open a fresh session before deleting:", error);
    return ids.filter((id) => id !== active);
  }
}

/**
 * @param {{ message: string, title: string }} options
 * @returns {Promise<boolean>}
 */
function confirmDelete({ message, title }) {
  return confirmDialog({
    title,
    message,
    confirmLabel: t("actions.delete"),
    danger: true,
  });
}

/** @param {number} count */
function confirmArchivedDeletion(count) {
  const message = t(
    count === 1 ? "sidebar.deleteArchivedConfirmOne" : "sidebar.deleteArchivedConfirmOther",
    { count },
  );
  return confirmDelete({ message, title: t("sidebar.deleteArchived") });
}

/**
 * Ids that are gone after a delete: the ones the host removed, plus chats
 * with no file yet (an empty chat Pi never saved), which exist only here.
 * @param {SessionSidebar} sidebar
 * @param {string[]} ids
 * @param {string[] | undefined} deleted
 */
function goneAfterDelete(sidebar, ids, deleted) {
  const gone = new Set(deleted || []);
  for (const id of ids) {
    const session = sidebar.sessions.find((item) => item.id === id);
    if (!session?.filePath) gone.add(id);
  }
  return gone;
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarArchive = /** @satisfies {ThisType<SessionSidebar>} */ ({
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
    saveJson(STORAGE.archived, this.archived);
    saveJson(STORAGE.favourites, this.favourites);
    this.render();
  },

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
    const ok = await confirmDelete({
      message: t("sidebar.deleteWorkspaceConfirm", { count: candidates.length }),
      title: t("sidebar.deleteWorkspaceSessions"),
    });
    if (!ok) return;
    const deletable = await leaveIfDeletingActive(this, candidates);
    if (deletable.length === 0) return;
    try {
      const { deleted } = await this.control.deleteSessions(deletable);
      const deletedSet = goneAfterDelete(this, deletable, deleted);
      if (deletedSet.size === 0) return;
      for (const id of deletable) {
        if (deletedSet.has(id)) this.pinnedStore?.unpinSession(id);
      }
      this.archived = this.archived.filter((id) => !deletedSet.has(id));
      saveJson(STORAGE.archived, this.archived);
      this.sessions = this.sessions.filter((session) => !deletedSet.has(session.id));
      this.render();
    } catch (error) {
      reportProjectActionError(this, error);
    }
  },

  // Permanently deletes every archived session from disk (after a confirm
  // dialog) and drops the successfully-deleted ids from local state.
  /**
   * @param {string[]} [only]
   */
  async deleteAllArchived(only) {
    const targets = (only ?? this.archived).filter((id) => this.archived.includes(id));
    if (targets.length === 0 || !this.control) return;
    const ok = await confirmArchivedDeletion(targets.length);
    if (!ok) return;
    const ids = await leaveIfDeletingActive(this, targets);
    if (ids.length === 0) return;
    try {
      const { deleted } = await this.control.deleteSessions(ids);
      const deletedSet = goneAfterDelete(this, ids, deleted);
      this.archived = this.archived.filter((id) => !deletedSet.has(id));
      saveJson(STORAGE.archived, this.archived);
      this.sessions = this.sessions.filter((session) => !deletedSet.has(session.id));
      this.render();
    } catch (error) {
      reportProjectActionError(this, error);
    }
  },
});
