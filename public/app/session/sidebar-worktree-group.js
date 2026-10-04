// ABOUTME: Renders a project's linked worktrees as nested groups in the session sidebar.
// ABOUTME: Each group has its own chats, a new-chat button, and merge or remove.

import { t } from "../i18n/i18n.js";
import { showContextMenu } from "../ui/context-menu.js";
import { createIcon } from "../ui/icons.js";
import { worktreeMenuRows } from "../worktree/worktree-actions.js";
import { STORAGE, writeStorage } from "./session-sidebar-prefs.js";
import { appendArchivedRow, startSessionIn } from "./session-sidebar-sections.js";
import { mountDisclosure } from "./sidebar-workspace-group.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarProject} SidebarProject
 */

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} project
 */
export function buildWorktreeGroups(sidebar, project) {
  const worktrees = project.worktrees || [];
  if (!worktrees.length) return null;
  const host = document.createElement("div");
  host.className = "worktree-groups";
  for (const worktree of worktrees) host.append(oneGroup(sidebar, worktree));
  return host;
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarProject} worktree
 */
function oneGroup(sidebar, worktree) {
  const collapsed = sidebar.projectsCollapsed[worktree.path] === true;
  const group = document.createElement("div");
  group.className = `worktree-group${worktree.isCurrent ? " current-project" : ""}`;
  const header = document.createElement("div");
  header.className = "project-header worktree-header";
  const icon = createIcon("git-branch", { size: 14 });
  if (icon) header.append(icon);
  const name = document.createElement("span");
  name.className = "project-name";
  name.textContent = worktree.name || worktree.path;
  name.title = worktree.path;
  const count = document.createElement("span");
  count.className = "project-count";
  count.textContent = String(
    (worktree.sessions?.length || 0) + (worktree.archivedSessions?.length || 0),
  );
  const add = document.createElement("button");
  add.type = "button";
  add.className = "project-new-chat-btn worktree-new-chat";
  add.title = t("worktree.newChat");
  add.setAttribute("aria-label", t("worktree.newChat"));
  add.textContent = "+";
  add.addEventListener("click", (event) => {
    event.stopPropagation();
    startSessionIn(sidebar, worktree);
  });
  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "workspace-more-actions-btn worktree-menu";
  menu.title = t("sidebar.workspaceActions");
  menu.setAttribute("aria-label", t("sidebar.workspaceActions"));
  const more = createIcon("ellipsis", { size: 14 });
  if (more) menu.append(more);
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    showContextMenu({
      event,
      items: worktreeMenuRows(sidebar, worktree, startSessionIn),
    });
  });
  header.append(name, count, add, menu);
  const list = document.createElement("div");
  list.className = "project-sessions";
  for (const session of worktree.sessions || []) list.append(sidebar.buildItem(session));
  appendArchivedRow(sidebar, list, worktree.path || "", worktree.archivedSessions);
  mountDisclosure(header, list, !collapsed, (open) => {
    sidebar.projectsCollapsed[worktree.path] = !open;
    writeStorage(STORAGE.projectsCollapsed, JSON.stringify(sidebar.projectsCollapsed));
  });
  group.append(header, list);
  return group;
}
