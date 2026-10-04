// ABOUTME: Sidebar actions for a git worktree: create, merge into the main checkout, and remove.
// ABOUTME: A dirty worktree asks once more before it is removed. The branch is kept.

import { t } from "../i18n/i18n.js";
import { rememberHiddenLocal } from "../session/missing-workspace.js";
import { reportProjectActionError } from "../session/session-sidebar-project-actions.js";
import { uiStore } from "../storage/ui-store.js";
import { copyText } from "../ui/clipboard.js";
import { confirmDialog, promptDialog } from "../ui/dialog.js";

/**
 * @typedef {import("../session/session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("../session/session-sidebar.js").SidebarProject} SidebarProject
 * @typedef {(sidebar: SessionSidebar, project: { path?: string, isCurrent?: boolean }) => void} StartSession
 */

const REFUSAL = {
  primary_dirty: "worktree.errors.primaryDirty",
  worktree_dirty: "worktree.errors.worktreeDirty",
  primary_detached: "worktree.errors.primaryDetached",
  worktree_detached: "worktree.errors.worktreeDetached",
  worktree_locked: "worktree.errors.locked",
  not_worktree: "worktree.errors.notWorktree",
  worktree_has_chats: "worktree.errors.hasChats",
};

/**
 * @param {unknown} error
 */
function refusalText(error) {
  const failure = /** @type {{ code?: string, message?: string }} */ (error);
  const key = failure?.code ? REFUSAL[/** @type {keyof typeof REFUSAL} */ (failure.code)] : "";
  if (key) {
    const text = t(key);
    if (text !== key) return text;
  }
  return failure?.message || String(error ?? "");
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 * @param {{ primaryPath?: string }} result
 * @param {StartSession} startSession
 */
async function finishRemove(sidebar, project, result, startSession) {
  rememberHiddenLocal(uiStore, "", project.path || "");
  sidebar.pinnedStore?.unpinWorkspace?.(project.path || "");
  if (project.isCurrent && result?.primaryPath) {
    startSession(sidebar, { path: result.primaryPath, isCurrent: false });
  }
  await sidebar.load?.();
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 * @param {StartSession} startSession
 * @param {{ confirmed?: boolean }} [options]
 */
export async function removeWorktreeFlow(
  sidebar,
  project,
  startSession,
  { confirmed = false } = {},
) {
  if (!confirmed) {
    const ok = await confirmDialog({ message: t("worktree.removeConfirm") });
    if (!ok) return;
  }
  try {
    const result = await sidebar.control?.removeWorktree?.(project.path, { force: false });
    await finishRemove(sidebar, project, result || {}, startSession);
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code !== "worktree_dirty") {
      await confirmDialog({ message: refusalText(error) });
      return;
    }
    const force = await confirmDialog({ message: t("worktree.removeDirty"), danger: true });
    if (!force) return;
    try {
      const result = await sidebar.control?.removeWorktree?.(project.path, { force: true });
      await finishRemove(sidebar, project, result || {}, startSession);
    } catch (again) {
      reportProjectActionError(sidebar, again);
    }
  }
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 * @param {StartSession} startSession
 */
async function mergeWorktreeFlow(sidebar, project, startSession) {
  const ok = await confirmDialog({ message: t("worktree.mergeConfirm") });
  if (!ok) return;
  try {
    const result = await sidebar.control?.mergeWorktree?.(project.path);
    if (result?.merged) {
      const remove = await confirmDialog({
        message: `${t("worktree.merged", { into: result.into || "" })} ${t("worktree.removeNow")}`,
        confirmLabel: t("worktree.remove"),
      });
      if (remove) await removeWorktreeFlow(sidebar, project, startSession, { confirmed: true });
      return;
    }
    const files = (result?.conflicts || []).filter(Boolean).join("\n");
    await confirmDialog({ message: `${t("worktree.conflicts")}\n${files}`.trim() });
  } catch (error) {
    await confirmDialog({ message: refusalText(error) });
  }
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 * @param {StartSession} startSession
 */
export async function createWorktreeFlow(sidebar, project, startSession) {
  const branch = await promptDialog({
    title: t("sidebar.newWorktree"),
    label: t("worktree.branch"),
    confirmLabel: t("sidebar.newWorktree"),
  });
  if (!branch?.trim()) return;
  try {
    const result = await sidebar.control?.createWorktree?.(project.path, branch.trim());
    if (result?.projectPath) {
      startSession(sidebar, { path: result.projectPath, isCurrent: false });
    }
    await sidebar.load?.();
  } catch (error) {
    reportProjectActionError(sidebar, error);
  }
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 * @param {StartSession} startSession
 */
export function worktreeMenuRows(sidebar, project, startSession) {
  return [
    {
      label: t("worktree.newChat"),
      action: () => startSession(sidebar, project),
    },
    {
      label: t("worktree.merge"),
      action: () => void mergeWorktreeFlow(sidebar, project, startSession),
    },
    {
      label: t("worktree.remove"),
      action: () => void removeWorktreeFlow(sidebar, project, startSession),
    },
    {
      label: t("files.copyPath"),
      action: () => void copyText(project.path || "").catch(() => {}),
    },
  ];
}
