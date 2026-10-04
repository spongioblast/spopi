// ABOUTME: Project folder actions from the sidebar: rename (moves the folder), close, keep chats, relink.
// ABOUTME: Moves stop the project's Pi first; afterwards the open session resumes or the list reloads.

import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { confirmDialog } from "../ui/dialog.js";
import { isHiddenPath, rememberHiddenLocal } from "./missing-workspace.js";
import { isWorkingSession } from "./session-sidebar-records.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarProject} SidebarProject
 */

/**
 * @param {SessionSidebar} sidebar
 * @param {unknown} error
 */
export function reportProjectActionError(sidebar, error) {
  console.error("[Sidebar] Project action failed:", error);
  sidebar.onError?.(error instanceof Error ? error : new Error(String(error)));
}

/**
 * The project's Pi process was stopped so its files could move. The open
 * session comes back in the project's new place; another project just
 * refreshes the list. After a failed move the page stays, so the error
 * stays on screen.
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 * @param {{ failed?: boolean }} [options]
 */
async function resumeAfterProjectMove(sidebar, project, { failed = false } = {}) {
  sidebar._chatReportsStale = true;
  const target = sidebar.getTarget?.();
  if (project.isCurrent && target?.workspaceId && target?.sessionId) {
    await sidebar.control?.restartRuntime?.(target.workspaceId, target.sessionId).catch(() => null);
    if (!failed) {
      window.location.reload();
      return;
    }
  }
  await sidebar.load({ quiet: true });
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 */
export async function closeProject(sidebar, project) {
  const running = (project.sessions ?? []).some((session) => isWorkingSession(session));
  if (running) {
    const ok = await confirmDialog({ message: t("sidebar.closeWorking") });
    if (!ok) return;
  }
  try {
    await sidebar.control?.closeProject?.(project.path);
  } catch (error) {
    reportProjectActionError(sidebar, error);
    return;
  }
  rememberHiddenLocal(uiStore, "", project.path);
  sidebar.pinnedStore?.unpinWorkspace?.(project.path);
  const next = sidebar.sessions.find(
    (session) =>
      session.projectPath !== project.path &&
      !isHiddenPath(session.projectPath) &&
      !sidebar.archived.includes(session.id ?? ""),
  );
  if (project.isCurrent) {
    if (next) sidebar.onSelect(next);
    else window.location.assign("/app?list=1");
    return;
  }
  sidebar.render();
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 */
export function startProjectRename(sidebar, project) {
  const nameEl = [...sidebar.container.querySelectorAll(".project-name")].find(
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
    const outside = sidebar.chatReports.get(project.path)?.inProjectsFolder !== true;
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
      const result = await sidebar.control?.renameProject?.(project.path, name);
      restore(name);
      if (result?.worktreeWarning) {
        await confirmDialog({
          title: t("sidebar.renameProject"),
          message: result.worktreeWarning,
        });
      }
      await resumeAfterProjectMove(sidebar, project);
    } catch (error) {
      restore(current);
      reportProjectActionError(sidebar, error);
      const target = sidebar.getTarget?.();
      if (project.isCurrent && target?.workspaceId && target?.sessionId) {
        await sidebar.control
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

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarProjectActions = /** @satisfies {ThisType<SessionSidebar>} */ ({
  /** @param {SidebarProject} project */
  async keepChats(project) {
    const ok = await confirmDialog({ message: t("sidebar.keepChatsConfirm") });
    if (!ok) return;
    let failed = false;
    try {
      await this.control?.keepChatsInProject?.(project.path);
    } catch (error) {
      failed = true;
      reportProjectActionError(this, error);
    }
    await resumeAfterProjectMove(this, project, { failed });
  },

  /** @param {SidebarProject} project */
  async relinkProject(project) {
    let failed = false;
    try {
      await this.control?.relinkProject?.(project.path);
    } catch (error) {
      failed = true;
      reportProjectActionError(this, error);
    }
    await resumeAfterProjectMove(this, project, { failed });
  },
});
