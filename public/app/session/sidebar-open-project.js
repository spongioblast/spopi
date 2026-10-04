// ABOUTME: Gives the open project a sidebar group before it has a saved chat.
// ABOUTME: Pi writes a session file only after the first message.

import { isHiddenPath } from "./missing-workspace.js";

/**
 * @typedef {{ workspaceId: string, projectPath: string, projectName: string, isGit?: boolean, worktreeOf?: string, branch?: string }} OpenProject
 * @typedef {{ path: string, name: string, isCurrent?: boolean, worktreeOf?: string, sessions?: unknown[], archivedSessions?: unknown[], worktrees?: unknown[] }} ProjectGroup
 */

/**
 * Windows paths differ in case and separators between the host list and
 * workspace info.
 * @param {string} a
 * @param {string} b
 */
export function sameProjectPath(a, b) {
  const key = (/** @type {string} */ path) =>
    path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return key(a) === key(b);
}

/**
 * Marks the open project's group current, or adds an empty one at the top when
 * none of its chats is saved yet (a new project, or a folder just opened).
 * @param {ProjectGroup[]} projects
 * @param {OpenProject | null | undefined} open
 * @param {Set<string | undefined>} pinnedPaths
 */
export function placeOpenProject(projects, open, pinnedPaths) {
  if (!open?.projectPath || projects.some((project) => project.isCurrent)) return;
  if (isHiddenPath(open.projectPath) || pinnedPaths.has(open.projectPath)) return;
  const existing = projects.find((project) => sameProjectPath(project.path, open.projectPath));
  if (existing) {
    existing.isCurrent = true;
    if (!existing.worktreeOf && open.worktreeOf) existing.worktreeOf = open.worktreeOf;
    return;
  }
  projects.unshift({
    path: open.projectPath,
    name: open.projectName,
    isCurrent: true,
    worktreeOf: open.worktreeOf || "",
    sessions: [],
    archivedSessions: [],
  });
}
