// ABOUTME: Nests linked git worktrees under their main checkout in the sidebar.
// ABOUTME: The link comes from each session. A worktree with no parent listed stays where it is.

/**
 * @param {string | null | undefined} path
 */
export function pathKey(path) {
  let text = String(path || "").replaceAll("\\", "/");
  if (/^\/\/\?\/UNC\//i.test(text)) text = `//${text.slice("//?/UNC/".length)}`;
  else text = text.replace(/^\/\/\?\//, "");
  return text.replace(/\/+$/, "").toLowerCase();
}

/**
 * @param {import("../session/session-sidebar.js").SidebarProject[]} projects
 * @returns {import("../session/session-sidebar.js").SidebarProject[]}
 */
export function nestWorktreeProjects(projects) {
  /** @type {Map<string, (typeof projects)[number]>} */
  const byKey = new Map();
  for (const project of projects) byKey.set(pathKey(project.path), project);
  /** @type {Set<(typeof projects)[number]>} */
  const nested = new Set();
  for (const project of projects) {
    const parentKey = pathKey(project.worktreeOf);
    if (!parentKey || parentKey === pathKey(project.path)) continue;
    const parent = byKey.get(parentKey);
    if (!parent || parent === project) continue;
    parent.worktrees = parent.worktrees || [];
    parent.worktrees.push(project);
    nested.add(project);
  }
  return projects.filter((project) => !nested.has(project));
}
