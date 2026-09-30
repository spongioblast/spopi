// ABOUTME: Tracks project folders the host could not open.
// ABOUTME: Close project hides the row. Locate moves its chats to the folder the user picks.

import { uiStore } from "../storage/ui-store.js";

const HIDDEN_KEY = "ui.workspaces.hidden";

/** @type {Set<string>} */
const missing = new Set();
/** @type {Set<string>} */
const hidden = new Set();

/**
 * @typedef {{ path: string, onRemove?: () => unknown, onError?: (error: unknown) => void }} MissingWorkspace
 */

/** @type {MissingWorkspace | null} */
let current = null;
/** @type {() => void} */
let painter = () => {};

/**
 * @param {unknown} path
 * @returns {string}
 */
function normalizeWorkspacePath(path) {
  return String(path || "")
    .trim()
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .toLowerCase();
}

/**
 * Text for a host or transport failure. Structured `{ error: { code } }` bodies
 * stay readable instead of becoming "[object Object]".
 * @param {unknown} error
 * @returns {string}
 */
export function describeHostError(error) {
  if (typeof error === "string") return error || "unknown error";
  if (error instanceof Error) {
    const code = /** @type {{ code?: unknown }} */ (error).code;
    const message = error.message && error.message !== "[object Object]" ? error.message : "";
    if (typeof code === "string" && code && message && message !== code) {
      return `${code}: ${message}`;
    }
    if (typeof code === "string" && code) return message || code;
    return message || "unknown error";
  }
  if (error && typeof error === "object") {
    const record = /** @type {{ message?: unknown, code?: unknown, error?: unknown }} */ (error);
    const nested =
      record.error && typeof record.error === "object"
        ? /** @type {{ code?: unknown, message?: unknown }} */ (record.error)
        : null;
    const code =
      (typeof record.code === "string" && record.code) ||
      (nested && typeof nested.code === "string" && nested.code) ||
      "";
    const message =
      (typeof record.message === "string" && record.message && record.message !== "[object Object]"
        ? record.message
        : "") || (nested && typeof nested.message === "string" ? nested.message : "");
    if (code && message && message !== code) return `${code}: ${message}`;
    if (code || message) return code || message;
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown error";
    }
  }
  if (error == null) return "unknown error";
  return String(error);
}

/**
 * @param {unknown} error
 */
export function isProjectNotFound(error) {
  const message = describeHostError(error);
  return /project[_ ]not[_ ]found/i.test(message) || /folder no longer exists/i.test(message);
}

/**
 * @param {unknown} path
 */
export function noteMissingPath(path) {
  const key = normalizeWorkspacePath(path);
  if (key) missing.add(key);
}

/**
 * @param {unknown} path
 */
export function isMissingPath(path) {
  const key = normalizeWorkspacePath(path);
  return key ? missing.has(key) : false;
}

/**
 * @param {unknown} path
 */
export function noteHiddenPath(path) {
  const key = normalizeWorkspacePath(path);
  if (key) hidden.add(key);
}

/**
 * @param {unknown} path
 */
export function isHiddenPath(path) {
  const key = normalizeWorkspacePath(path);
  return key ? hidden.has(key) : false;
}

/**
 * @param {{ getItem?: (key: string) => string | null }} [store]
 */
export function syncHiddenFromStore(store = uiStore) {
  const raw = store?.getItem?.(HIDDEN_KEY);
  if (!raw) return;
  /** @type {unknown} */
  let rows;
  try {
    rows = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    noteHiddenPath(/** @type {{ path?: unknown, id?: unknown }} */ (row).path);
    noteHiddenPath(/** @type {{ path?: unknown, id?: unknown }} */ (row).id);
  }
}

/**
 * @param {{ setItem?: (key: string, value: string) => void, getItem?: (key: string) => string | null }} store
 * @param {string} id
 * @param {string} path
 */
export function rememberHiddenLocal(store, id, path) {
  noteHiddenPath(path);
  noteHiddenPath(id);
  /** @type {Array<{ id?: string, path?: string }>} */
  let rows = [];
  try {
    const parsed = JSON.parse(String(store?.getItem?.(HIDDEN_KEY) || "[]"));
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    rows = [];
  }
  rows.push({ id, path });
  store?.setItem?.(HIDDEN_KEY, JSON.stringify(rows));
}

/** @param {() => void} next */
export function setMissingPainter(next) {
  painter = next;
}

/** @param {MissingWorkspace} next */
export function showMissingWorkspace(next) {
  current = { path: String(next.path || ""), onRemove: next.onRemove, onError: next.onError };
  noteMissingPath(current.path);
  painter();
}

export function clearMissingWorkspace() {
  if (!current) return;
  current = null;
  painter();
}

export function missingWorkspace() {
  return current;
}

/** Tests drop the in-memory sets between cases. */
export function resetMissingWorkspaces() {
  missing.clear();
  hidden.clear();
  current = null;
}
