// ABOUTME: Lazy file-tree state: children map, expanded set, generation, git overlay.
// ABOUTME: Inspired by PiDeck merge/stale-gen (reimplemented; not copied).

/**
 * @typedef {{ kind?: string, name?: string, relativePath?: string, size?: number, mode?: string, isDirectory?: boolean }} FileTreeEntry
 * @typedef {{ path?: string, relativePath?: string, code?: string, status?: string }} GitStatusFile
 * @typedef {{
 *   workspaceId: string,
 *   showHidden: boolean,
 *   childrenByPath: Map<string, FileTreeEntry[]>,
 *   expanded: Set<string>,
 *   selectedPath: string | null,
 *   generation: number,
 *   gitByPath: Map<string, { code?: string, status?: string }>,
 *   gitDirs: Map<string, string>,
 *   untrackedDirs: Set<string>,
 * }} FileTreeState
 * @typedef {{
 *   path: string,
 *   name?: string,
 *   kind?: string,
 *   depth: number,
 *   expanded: boolean,
 *   loaded: boolean,
 *   gitCode?: string,
 *   gitStatus?: string,
 * }} FileTreeRow
 */

/** @param {FileTreeEntry[]} [entries] @returns {FileTreeEntry[]} */
function sortEntries(entries = []) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return String(left.name || "").localeCompare(String(right.name || ""), undefined, {
      sensitivity: "base",
    });
  });
}

/** @param {unknown} rel @returns {string[]} */
export function ancestorPaths(rel) {
  const parts = String(rel || "")
    .split("/")
    .filter(Boolean);
  /** @type {string[]} */
  const out = [];
  for (let index = 1; index < parts.length; index += 1) {
    out.push(parts.slice(0, index).join("/"));
  }
  return out;
}

/** @param {{ workspaceId?: string, showHidden?: boolean }} [options] @returns {FileTreeState} */
export function createFileTreeState({ workspaceId = "", showHidden = false } = {}) {
  return {
    workspaceId,
    showHidden,
    childrenByPath: new Map(),
    expanded: new Set(),
    selectedPath: null,
    generation: 0,
    gitByPath: new Map(),
    gitDirs: new Map(),
    untrackedDirs: new Set(),
  };
}

/** @param {FileTreeState} state @returns {number} */
export function nextGeneration(state) {
  state.generation += 1;
  return state.generation;
}

/**
 * @param {FileTreeState} state
 * @param {string} path
 * @param {FileTreeEntry[] | null | undefined} entries
 * @param {number} generation
 * @returns {boolean}
 */
export function applyDir(state, path, entries, generation) {
  if (generation !== state.generation) return false;
  state.childrenByPath.set(path, sortEntries(entries || []));
  return true;
}

/** @param {FileTreeState} state @param {string} path @returns {{ expanded: boolean, needsLoad: boolean }} */
export function toggleExpanded(state, path) {
  if (!path) return { expanded: true, needsLoad: !state.childrenByPath.has("") };
  if (state.expanded.has(path)) {
    state.expanded.delete(path);
    return { expanded: false, needsLoad: false };
  }
  state.expanded.add(path);
  return { expanded: true, needsLoad: !state.childrenByPath.has(path) };
}

/** @param {FileTreeState} state */
export function collapseAll(state) {
  state.expanded.clear();
}

/** @param {FileTreeState} state @returns {string[]} */
export function pathsToReload(state) {
  /** @type {string[]} */
  const out = [""];
  const seen = new Set([""]);
  /** @type {string[]} */
  const queue = [""];
  while (queue.length) {
    const path = queue.shift();
    if (path === undefined) break;
    for (const entry of state.childrenByPath.get(path) || []) {
      if (entry.kind !== "directory" || typeof entry.relativePath !== "string") continue;
      if (!state.expanded.has(entry.relativePath)) continue;
      if (seen.has(entry.relativePath)) continue;
      seen.add(entry.relativePath);
      out.push(entry.relativePath);
      queue.push(entry.relativePath);
    }
  }
  for (const path of state.expanded) {
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

/** @param {FileTreeState} state @returns {FileTreeRow[]} */
export function visibleRows(state) {
  /** @type {FileTreeRow[]} */
  const rows = [];
  /**
   * @param {string} path
   * @param {number} depth
   */
  const walk = (path, depth) => {
    const children = state.childrenByPath.get(path);
    if (!children) return;
    for (const entry of children) {
      const isDir = entry.kind === "directory";
      const rel = entry.relativePath || "";
      const git = isDir ? null : fileGit(state, rel);
      rows.push({
        path: rel,
        name: entry.name,
        kind: entry.kind,
        depth,
        expanded: isDir && state.expanded.has(rel),
        loaded: isDir && state.childrenByPath.has(rel),
        gitCode: git?.code,
        gitStatus: isDir ? state.gitDirs.get(rel) : git?.status,
      });
      if (isDir && state.expanded.has(entry.relativePath || ""))
        walk(entry.relativePath || "", depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** A folder shows the most urgent state inside it. */
const GIT_RANK = /** @type {Record<string, number>} */ ({
  untracked: 1,
  added: 2,
  renamed: 3,
  modified: 4,
  deleted: 5,
  conflict: 6,
});

/**
 * Git reports a wholly new folder as one `dir/` entry, so files under it are
 * untracked even though they have no entry of their own.
 * @param {FileTreeState} state
 * @param {string} rel
 */
function fileGit(state, rel) {
  const own = state.gitByPath.get(rel);
  if (own) return own;
  if (!state.untrackedDirs.size) return null;
  const inside = ancestorPaths(rel).some((dir) => state.untrackedDirs.has(dir));
  return inside ? { code: "U", status: "untracked" } : null;
}

/** @param {FileTreeState} state @param {GitStatusFile[]} [files] */
export function applyGitOverlay(state, files = []) {
  state.gitByPath.clear();
  state.gitDirs.clear();
  state.untrackedDirs.clear();
  /** @param {string} dir @param {string} status */
  const raise = (dir, status) => {
    const current = state.gitDirs.get(dir);
    if (!current || (GIT_RANK[status] || 0) > (GIT_RANK[current] || 0)) {
      state.gitDirs.set(dir, status);
    }
  };
  for (const file of files) {
    const raw = file.path || file.relativePath;
    if (!raw) continue;
    const isDir = raw.endsWith("/");
    const path = raw.replace(/\/+$/, "");
    const status = file.status || "modified";
    if (isDir) {
      raise(path, status);
      if (status === "untracked") state.untrackedDirs.add(path);
    } else {
      state.gitByPath.set(path, { code: file.code, status: file.status });
    }
    for (const dir of ancestorPaths(path)) raise(dir, status);
  }
}

/** @param {FileTreeState} state @param {number} [cap] @returns {string[]} */
export function persistExpandedPaths(state, cap = 200) {
  return [...state.expanded].slice(0, cap);
}

/**
 * Map a porcelain v2 git_status snapshot onto file-tree badges.
 * @param {unknown} frame
 * @returns {GitStatusFile[]}
 */
export function filesFromGitSnapshot(frame) {
  const record =
    frame && typeof frame === "object" ? /** @type {Record<string, unknown>} */ (frame) : null;
  const snapshot = record && "snapshot" in record ? record.snapshot : record;
  const entries =
    snapshot && typeof snapshot === "object" && "entries" in snapshot
      ? /** @type {{ entries?: unknown }} */ (snapshot).entries
      : [];
  if (!Array.isArray(entries)) return [];
  /** @type {GitStatusFile[]} */
  const files = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = /** @type {{ displayPath?: string, xy?: string, entryKind?: string }} */ (entry);
    const path = row.displayPath || "";
    if (!path || row.entryKind === "ignored") continue;
    const classified = classifyGitXy(String(row.xy || ""), row.entryKind);
    files.push({ path, code: classified.code, status: classified.status });
  }
  return files;
}

/**
 * @param {string} xy
 * @param {string | undefined} entryKind
 */
function classifyGitXy(xy, entryKind) {
  if (entryKind === "untracked") return { code: "U", status: "untracked" };
  if (entryKind === "unmerged") return { code: "C", status: "conflict" };
  const x = xy[0] || " ";
  const y = xy[1] || " ";
  if ((x === "D" && y === "D") || (x === "A" && y === "A") || x === "U" || y === "U") {
    return { code: "C", status: "conflict" };
  }
  if (x === "?" && y === "?") return { code: "U", status: "untracked" };
  if (x === "D" || y === "D") return { code: "D", status: "deleted" };
  if (x === "R" || y === "R") return { code: "R", status: "renamed" };
  if (x === "A" || y === "A") return { code: "A", status: "added" };
  return { code: "M", status: "modified" };
}

/** @param {FileTreeState} state @param {unknown} [paths] */
export function restoreExpanded(state, paths = []) {
  const list = Array.isArray(paths) ? paths : [];
  /** @type {string[]} */
  const kept = [];
  for (const path of list) {
    if (typeof path === "string" && path) kept.push(path);
  }
  state.expanded = new Set(kept);
}
