// ABOUTME: Loads one review scope: a turn, the session, or the git working tree.
// ABOUTME: Paths outside the project are listed and never fetched; SPOPI UI files are named as such.

import { buildDiff } from "./review-diff-model.js";

const PAIR_LIMIT = 4;

/**
 * @param {string} path
 * @param {string} root
 */
export function toWorkspaceRelative(path, root) {
  const file = stripPrefix(String(path || "").replaceAll("\\", "/"));
  const base = stripPrefix(
    String(root || "")
      .replaceAll("\\", "/")
      .replace(/\/+$/, ""),
  );
  if (!base) return file;
  const windows = /^[a-zA-Z]:/.test(base);
  const fileCmp = windows ? file.toLowerCase() : file;
  const baseCmp = windows ? base.toLowerCase() : base;
  if (fileCmp === baseCmp) return "";
  if (fileCmp.startsWith(`${baseCmp}/`)) return file.slice(base.length + 1);
  return file;
}

/**
 * `\\?\D:\proj` is the same folder as `D:\proj`; the host stores the first form.
 * @param {string} path
 */
function stripPrefix(path) {
  if (/^\/\/\?\/UNC\//i.test(path)) return `//${path.slice("//?/UNC/".length)}`;
  return path.replace(/^\/\/\?\//, "");
}

/**
 * @param {string} path
 */
function isOutside(path) {
  if (!path) return false;
  if (path.split("/").includes("..")) return true;
  return path.startsWith("/") || /^[a-zA-Z]:/.test(path);
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 */
async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 */
function fallbackLabel(key, params = {}) {
  if (key === "review.label.turn") return `Turn ${params.n ?? ""}`;
  if (key === "review.label.latest") return "Latest turn";
  if (key === "review.label.session") return "This session";
  if (key === "review.label.git") return "Working tree";
  return key;
}

/**
 * @param {{
 *   control?: {
 *     shadowHistoryFiles?: (workspaceId: string, sessionId?: string, scope?: string) => Promise<any>,
 *     shadowHistoryFilePair?: (workspaceId: string, sessionId: string, path: string, scope: string) => Promise<any>,
 *   },
 *   files?: { readFile?: (path: string) => Promise<any> },
 *   git?: {
 *     status?: () => Promise<any>,
 *     fileAtHeadText?: (pathBytesBase64: string) => Promise<any>,
 *   },
 *   getTarget?: () => { workspaceId?: string, sessionId?: string, projectPath?: string } | null | undefined,
 *   isGitRepo?: () => boolean,
 *   uiRoot?: () => Promise<string> | string,
 *   projectRoot?: () => Promise<string> | string,
 *   t?: (key: string, params?: Record<string, unknown>) => string,
 * }} deps
 */
export function createReviewSources(deps) {
  const translate = deps.t || fallbackLabel;

  async function uiRoot() {
    try {
      return String((await deps.uiRoot?.()) || "");
    } catch {
      return "";
    }
  }

  // Without it, a project the history has not recorded yet has no root, and every
  // absolute path Pi wrote would count as outside the project.
  async function projectRoot() {
    try {
      return String((await deps.projectRoot?.()) || "");
    } catch {
      return "";
    }
  }

  /**
   * @param {string} scopeKey
   * @param {{ extraPaths?: string[] }} [options]
   */
  async function load(scopeKey, options = {}) {
    if (scopeKey === "git") return loadGit();
    return loadShadow(scopeKey, options.extraPaths || []);
  }

  /**
   * @param {string} scopeKey
   * @param {string[]} extraPaths
   */
  async function loadShadow(scopeKey, extraPaths) {
    const current = deps.getTarget?.() || {};
    const workspaceId = current.workspaceId || "";
    const sessionId = current.sessionId || "";
    const record = await deps.control?.shadowHistoryFiles?.(workspaceId, sessionId, scopeKey);
    const meta = record?.meta;
    const root =
      current.projectPath ||
      (await projectRoot()) ||
      (typeof meta?.realpath === "string" && meta.realpath) ||
      (typeof meta?.cwd === "string" && meta.cwd) ||
      "";
    const label = shadowLabel(scopeKey, record);
    const extras = outsideOnly(extraPaths, root, await uiRoot());
    if (record?.empty && !record?.meta) {
      return { scopeKey, label, turn: record?.turn, files: extras, unavailable: "noHistory" };
    }
    if (scopeKey.startsWith("turn:") && !record?.turn) {
      return { scopeKey, label: "", files: extras, unavailable: "turnGone" };
    }
    const listed = Array.isArray(record?.files) ? record.files : [];
    /** @type {Map<string, any>} */
    const merged = new Map();
    for (const file of listed) {
      const relative = toWorkspaceRelative(file?.path || "", root);
      if (!relative || merged.has(relative)) continue;
      merged.set(relative, file);
    }
    const pairs = await mapLimit([...merged.entries()], PAIR_LIMIT, async ([relative, file]) => {
      if (isOutside(relative)) return outsideFile(relative);
      const pair = await deps.control?.shadowHistoryFilePair?.(
        workspaceId,
        sessionId,
        file.path || relative,
        scopeKey,
      );
      return fileFromPair(relative, file, pair);
    });
    const files = [...pairs, ...extras].filter(
      (file, index, all) => all.findIndex((item) => item.path === file.path) === index,
    );
    return { scopeKey, label, turn: record?.turn, files };
  }

  async function loadGit() {
    const label = translate("review.label.git");
    if (deps.isGitRepo && !deps.isGitRepo()) {
      return { scopeKey: "git", label, files: [], unavailable: "noGit" };
    }
    let status;
    try {
      status = await deps.git?.status?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const noGit = /not a git repository/i.test(message);
      return { scopeKey: "git", label, files: [], unavailable: noGit ? "noGit" : "loadFailed" };
    }
    const entries = Array.isArray(status) ? status : status?.entries || [];
    /** @type {any[]} */
    const files = [];
    for (const entry of entries) {
      const statusLetter = gitLetter(entry);
      if (!statusLetter) continue;
      const path = String(entry.displayPath || entry.path || "");
      if (!path) continue;
      const built = await gitFile(path, entry, statusLetter);
      if (built) files.push(built);
    }
    return { scopeKey: "git", label, files };
  }

  /**
   * @param {string} path
   * @param {any} entry
   * @param {string} status
   */
  async function gitFile(path, entry, status) {
    let before = "";
    let binary = false;
    if (status !== "A" && entry.pathBytesBase64 && deps.git?.fileAtHeadText) {
      try {
        const head = await deps.git.fileAtHeadText(entry.pathBytesBase64);
        before = typeof head?.content === "string" ? head.content : "";
        binary = head?.binary === true;
      } catch {
        before = "";
      }
    }
    let after = "";
    if (status !== "D") {
      try {
        const read = await deps.files?.readFile?.(path);
        if (read?.isBinary) binary = true;
        else after = typeof read?.content === "string" ? read.content : "";
      } catch {
        after = "";
      }
    }
    if (binary) return { path, status, kind: "binary", add: 0, del: 0, before: "", after: "" };
    const diff = buildDiff(before, after);
    const kind = diff.tooLarge ? "tooLarge" : "text";
    return { path, status, kind, add: diff.add, del: diff.del, before, after, diff };
  }

  /**
   * @param {string} scopeKey
   * @param {any} record
   */
  function shadowLabel(scopeKey, record) {
    if (scopeKey === "session") return translate("review.label.session");
    const index = record?.turn?.index;
    if (typeof index === "number") return translate("review.label.turn", { n: index });
    return translate("review.label.latest");
  }

  return { load };
}

/**
 * @param {string} path
 */
function outsideFile(path) {
  return { path, status: "M", kind: "outside", add: 0, del: 0, before: "", after: "" };
}

/**
 * Pi's writes that the project history cannot see. Files in SPOPI's UI folder are
 * named "SPOPI UI/..." and are reverted from Customizations, not by /undo.
 * @param {string[]} extraPaths
 * @param {string} root
 * @param {string} [ui]
 */
function outsideOnly(extraPaths, root, ui = "") {
  /** @type {any[]} */
  const files = [];
  for (const path of extraPaths) {
    const relative = toWorkspaceRelative(path, root);
    if (!relative || !isOutside(relative)) continue;
    const inUi = ui ? toWorkspaceRelative(path, ui) : relative;
    const file =
      ui && inUi && !isOutside(inUi) ? appFile(`SPOPI UI/${inUi}`) : outsideFile(relative);
    if (!files.some((item) => item.path === file.path)) files.push(file);
  }
  return files;
}

/**
 * @param {string} path
 */
function appFile(path) {
  return { path, status: "M", kind: "app", add: 0, del: 0, before: "", after: "" };
}

/**
 * @param {string} path
 * @param {any} listed
 * @param {any} pair
 */
function fileFromPair(path, listed, pair) {
  const before = typeof pair?.before === "string" ? pair.before : "";
  const after = typeof pair?.after === "string" ? pair.after : "";
  const beforeExists =
    pair?.beforeExists === true || (pair?.beforeExists !== false && before !== "");
  const afterExists = pair?.afterExists === true || (pair?.afterExists !== false && after !== "");
  const status =
    listed?.status ||
    (beforeExists && !afterExists ? "D" : !beforeExists && afterExists ? "A" : "M");
  if (pair?.binary) return { path, status, kind: "binary", add: 0, del: 0, before: "", after: "" };
  if (pair?.tooLarge) return { path, status, kind: "tooLarge", add: 0, del: 0, before, after };
  const diff = buildDiff(before, after);
  if (diff.tooLarge) return { path, status, kind: "tooLarge", add: 0, del: 0, before, after, diff };
  return { path, status, kind: "text", add: diff.add, del: diff.del, before, after, diff };
}

/**
 * @param {any} entry
 */
function gitLetter(entry) {
  if (entry?.entryKind === "unmerged") return "";
  if (entry?.entryKind === "untracked") return "A";
  const xy = String(entry?.xy || entry?.status || "M");
  if (xy.includes("U")) return "";
  if (xy === "??") return "A";
  const work = xy.length >= 2 ? xy[1] : xy[0];
  const index = xy[0];
  if (work === "D" || (index === "D" && (work === "." || work === " "))) return "D";
  if ((index === "A" || index === "?") && (work === "." || work === " " || work === "?"))
    return "A";
  return "M";
}
