// ABOUTME: Persists ordered workspace and session Pins in the ui.* preference store.
// ABOUTME: Owns capacity checks, deduplication, and change detection.

import { uiStore } from "../storage/ui-store.js";

/**
 * Pinned Items — ordered workspace and session Pins in the ui.* store.
 *
 * Owns parsing, normalization, deduplication, capacity-bounded writes,
 * and change detection. The store is keyed by
 * `project.path` (workspace) and `session.id` (session) - both stable for
 * the current session lifetime; restart-fresh ids invalidate the pin, by
 * design, matching the lifetime of `favourites` / `archived` lists.
 *
 * Mutations read the newest storage value immediately before rewriting so
 * concurrent tabs converge. Pins never evict: a mutation that would exceed
 * MAX_PINNED_ITEMS is rejected with a typed error and the existing storage
 * value is preserved.
 *
 * @typedef {{ id: string, path: string }} PinnedWorkspace
 * @typedef {{ workspaces: PinnedWorkspace[], sessions: string[] }} PinnedState
 * @typedef {{
 *   getItem?: (key: string) => string | null,
 *   setItem?: (key: string, value: string) => void,
 * }} PinnedStorage
 * @typedef {{
 *   attemptedCount?: number,
 *   limitCount?: number,
 *   previousState?: PinnedState,
 * }} PinnedCapacityContext
 * @typedef {{
 *   dispatchEvent: (event: Event) => boolean,
 *   addEventListener: (
 *     type: string,
 *     listener: EventListenerOrEventListenerObject,
 *     options?: boolean | AddEventListenerOptions,
 *   ) => void,
 *   removeEventListener: (
 *     type: string,
 *     listener: EventListenerOrEventListenerObject,
 *     options?: boolean | EventListenerOptions,
 *   ) => void,
 *   CustomEvent: new (type: string, eventInitDict?: CustomEventInit) => CustomEvent,
 * }} PinnedWindow
 * @typedef {{
 *   windowRef: PinnedWindow | null,
 *   documentRef: Document | null,
 *   storageRef: PinnedStorage | null,
 *   cleanup: () => void,
 * }} PinnedSyncHandle
 */

const PINNED_ITEMS_KEY = "ui.sessions.pinnedItems";
const PINNED_ITEMS_EVENT = "spopi:pinned-items-change";
// Total cap across both workspaces and sessions keeps the sidebar section scannable.
const MAX_PINNED_ITEMS = 20;
const PINNED_SCHEMA_VERSION = 1;

/** @returns {PinnedStorage | null} */
function defaultStorage() {
  try {
    return uiStore;
  } catch {
    return null;
  }
}

/** @returns {PinnedWindow | null} */
function defaultWindow() {
  return typeof window !== "undefined" ? /** @type {PinnedWindow} */ (window) : null;
}

/**
 * Error thrown when a mutation would exceed the item-count limit. The
 * existing storage value is left untouched; `previousState` holds the last
 * committed state so callers can render localized feedback without losing data.
 */
class PinnedCapacityError extends Error {
  /** @type {number} */
  attemptedCount;
  /** @type {number} */
  limitCount;
  /** @type {PinnedState} */
  previousState;

  /**
   * @param {string} message
   * @param {PinnedCapacityContext} [context]
   */
  constructor(message, context = {}) {
    super(message);
    this.name = "PinnedCapacityError";
    this.attemptedCount = context.attemptedCount ?? 0;
    this.limitCount = context.limitCount ?? MAX_PINNED_ITEMS;
    this.previousState = context.previousState ?? { workspaces: [], sessions: [] };
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, PinnedCapacityError);
    }
  }
}

// Normalize a workspace pin record. In the native arch the workspace key
// is the on-disk `project.path` - it serves as both identity and display
// path, and there is no separate stable history id.
/**
 * @param {unknown} record
 * @returns {PinnedWorkspace | null}
 */
function normalizeWorkspaceRecord(record) {
  if (!record || typeof record !== "object") return null;
  const path =
    typeof (/** @type {{ path?: unknown }} */ (record).path) === "string"
      ? /** @type {{ path: string }} */ (record).path.trim()
      : "";
  if (!path) return null;
  return { id: path, path };
}

/**
 * Build a normalized, deduplicated Pin state from arbitrary input.
 *
 * - Workspace records require a `history:` / `path:` id and a non-empty path;
 *   duplicates (by id) are dropped while preserving first-seen order.
 * - Sessions require non-empty strings; duplicates are dropped preserving order.
 * - Malformed payloads collapse to an empty (recoverable) state.
 *
 * @param {unknown} payload
 * @returns {PinnedState}
 */
function normalizePinnedState(payload) {
  /** @type {PinnedWorkspace[]} */
  const workspaces = [];
  /** @type {string[]} */
  const sessions = [];

  if (!payload || typeof payload !== "object") return { workspaces, sessions };

  const rawWorkspaces = Array.isArray(/** @type {{ workspaces?: unknown }} */ (payload).workspaces)
    ? /** @type {{ workspaces: unknown[] }} */ (payload).workspaces
    : [];
  const seenWorkspaceIds = new Set();
  for (const record of rawWorkspaces) {
    const normalized = normalizeWorkspaceRecord(record);
    if (!normalized || seenWorkspaceIds.has(normalized.id)) continue;
    seenWorkspaceIds.add(normalized.id);
    workspaces.push(normalized);
  }

  const rawSessions = Array.isArray(/** @type {{ sessions?: unknown }} */ (payload).sessions)
    ? /** @type {{ sessions: unknown[] }} */ (payload).sessions
    : [];
  const seenSessions = new Set();
  for (const session of rawSessions) {
    if (typeof session !== "string" || !session || seenSessions.has(session)) continue;
    seenSessions.add(session);
    sessions.push(session);
  }

  return { workspaces, sessions };
}

/**
 * @param {PinnedState} state
 * @returns {{ v: number, workspaces: PinnedWorkspace[], sessions: string[] }}
 */
function serializeState(state) {
  return {
    v: PINNED_SCHEMA_VERSION,
    workspaces: state.workspaces.map((workspace) => ({ id: workspace.id, path: workspace.path })),
    sessions: state.sessions.slice(),
  };
}

/** @param {PinnedState} state */
function serializedForCompare(state) {
  return JSON.stringify(serializeState(state));
}

/**
 * @param {PinnedState} a
 * @param {PinnedState} b
 */
function samePinnedState(a, b) {
  return serializedForCompare(a) === serializedForCompare(b);
}

// Item-count cap replaces the byte-length cap from the cookie-based original.
// The flat MAX_PINNED_ITEMS budget covers both workspaces and sessions so
// neither dimension can crowd out the other.
/** @param {{ workspaces?: unknown[], sessions?: unknown[] }} state */
function itemCount(state) {
  return (state.workspaces?.length ?? 0) + (state.sessions?.length ?? 0);
}

/** @param {PinnedStorage | null | undefined} storageRef */
function readStorageValue(storageRef) {
  try {
    const raw = storageRef?.getItem?.(PINNED_ITEMS_KEY);
    return raw ?? null;
  } catch {
    // Preference reads can fail in sandboxed or disabled contexts.
  }
  return null;
}

/**
 * Read and normalize the current Pin cookie. Malformed cookies resolve to an
 * empty state so the UI stays usable and recoverable.
 *
 * @param {PinnedStorage | null} [storageRef]
 * @returns {PinnedState}
 */
function readPinnedItems(storageRef = defaultStorage()) {
  const value = readStorageValue(storageRef);
  if (!value) return { workspaces: [], sessions: [] };
  try {
    return normalizePinnedState(JSON.parse(value));
  } catch {
    return { workspaces: [], sessions: [] };
  }
}

/**
 * Validate and write a full Pin state.
 *
 * Reads the newest storage value immediately before writing, skips a no-op
 * write, and rejects — without eviction — when the item count would exceed
 * MAX_PINNED_ITEMS. The previous committed state is attached to the
 * capacity error so callers can recover gracefully.
 *
 * @param {unknown} nextState
 * @param {PinnedStorage | null} [storageRef]
 * @returns {PinnedState}
 */
function writePinnedItems(nextState, storageRef = defaultStorage()) {
  const normalized = normalizePinnedState(nextState);
  const current = readPinnedItems(storageRef);
  if (samePinnedState(current, normalized)) return normalized;

  const attemptedCount = itemCount(normalized);
  if (attemptedCount > MAX_PINNED_ITEMS) {
    throw new PinnedCapacityError("Pin list would exceed the maximum item count", {
      attemptedCount,
      limitCount: MAX_PINNED_ITEMS,
      previousState: current,
    });
  }

  try {
    const value = JSON.stringify(serializeState(normalized));
    storageRef?.setItem?.(PINNED_ITEMS_KEY, value);
  } catch {
    // Keep `normalized` as the caller's in-memory state.
  }
  // Notify subscribers so a sidebar wired via `pinnedStore.subscribe`
  // re-renders without a manual `render()` call. The store wrapper
  // (createPinnedItemsStore) maintains its own emit; this is the
  // lightweight version used by the top-level pin*/unpin* helpers,
  // which do not allocate a full store.
  notifyChanged(normalized, defaultWindow());
  return normalized;
}

// --- Cross-window change detection --------------------------------------

/** @type {Set<(state: PinnedState) => void>} */
const subscribers = new Set();
/** @type {string | null} */
let lastCompared = null;
/** @type {PinnedSyncHandle | null} */
let activeSync = null;

/**
 * @param {PinnedState} state
 * @param {PinnedWindow | null | undefined} windowRef
 */
function notifyChanged(state, windowRef) {
  const serialized = serializedForCompare(state);
  if (serialized === lastCompared) return false;
  lastCompared = serialized;
  for (const callback of subscribers) {
    try {
      callback(state);
    } catch {
      // A listener error must not break convergence.
    }
  }
  if (windowRef && typeof windowRef.dispatchEvent === "function") {
    try {
      windowRef.dispatchEvent(new windowRef.CustomEvent(PINNED_ITEMS_EVENT, { detail: state }));
    } catch {
      // Event dispatch is best-effort.
    }
  }
  return true;
}

/**
 * Start cross-window Pin synchronization.
 *
 * Re-reads storage on window focus and on `visibilitychange` (when becoming
 * visible), dispatching `PINNED_ITEMS_EVENT` and notifying subscribers only
 * when the value changes. Returns a cleanup function that removes listeners.
 *
 * No interval polling is started; in-process mutations notify directly.
 *
 * @param {{
 *   windowRef?: PinnedWindow | null,
 *   documentRef?: Document | null,
 *   storageRef?: PinnedStorage | null,
 * }} [options]
 * @returns {() => void}
 */
export function startPinnedItemsSync({
  windowRef = defaultWindow(),
  documentRef = typeof document !== "undefined" ? document : null,
  storageRef = defaultStorage(),
} = {}) {
  if (activeSync?.cleanup) activeSync.cleanup();
  activeSync = null;

  const check = () => {
    if (documentRef && documentRef.visibilityState === "hidden") return;
    const state = readPinnedItems(storageRef);
    notifyChanged(state, windowRef);
  };

  const onFocus = () => {
    check();
  };
  const onVisibility = () => {
    if (documentRef && documentRef.visibilityState === "visible") check();
  };

  if (windowRef) {
    windowRef.addEventListener("focus", onFocus);
    windowRef.addEventListener("visibilitychange", onVisibility);
  }

  // Seed the baseline so the first change is relative to the initial value.
  lastCompared = serializedForCompare(readPinnedItems(storageRef));

  const cleanup = () => {
    if (windowRef) {
      windowRef.removeEventListener("focus", onFocus);
      windowRef.removeEventListener("visibilitychange", onVisibility);
    }
    if (activeSync?.cleanup === cleanup) {
      activeSync = null;
    }
  };

  activeSync = { windowRef, documentRef, storageRef, cleanup };

  return cleanup;
}

/**
 * @param {{
 *   storageRef?: PinnedStorage | null,
 *   storage?: PinnedStorage | null,
 *   windowRef?: PinnedWindow | null,
 *   window?: PinnedWindow | null,
 * }} [options]
 */
export function createPinnedItemsStore(options = {}) {
  const storageRef = options.storageRef ?? options.storage ?? defaultStorage();
  const windowRef = options.windowRef ?? options.window ?? defaultWindow();
  let destroyed = false;
  /** @type {Set<(state: PinnedState) => void>} */
  const listeners = new Set();
  let state = readPinnedItems(storageRef);
  const snapshot = () => ({
    workspaces: state.workspaces.map((item) => ({ ...item })),
    sessions: [...state.sessions],
  });
  /** @param {PinnedState} next */
  const emit = (next) => {
    const before = JSON.stringify(state);
    state = next;
    if (before === JSON.stringify(next)) return false;
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {}
    }
    return true;
  };
  /** @param {(current: PinnedState) => PinnedState} operation */
  const mutate = (operation) => {
    if (destroyed) return { ok: false, error: "write", state: snapshot(), changed: false };
    try {
      const current = readPinnedItems(storageRef);
      const next = operation(current);
      const written = writePinnedItems(next, storageRef);
      const changed = emit(written);
      return { ok: true, changed, state: snapshot() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof PinnedCapacityError ? "capacity" : "write",
        state: snapshot(),
        changed: false,
      };
    }
  };
  const refreshFromStorage = () => {
    const next = readPinnedItems(storageRef);
    emit(next);
    return snapshot();
  };
  const onFocus = refreshFromStorage;
  const onVisibility = () => {
    if (refreshFromStorage) refreshFromStorage();
  };
  windowRef?.addEventListener?.("focus", onFocus);
  windowRef?.addEventListener?.("visibilitychange", onVisibility);
  return {
    getState: snapshot,
    getRenderableState: () => snapshot(),
    /** @param {string} id */
    isWorkspacePinned: (id) => state.workspaces.some((item) => item.id === id),
    /** @param {string} sessionId */
    isSessionPinned: (sessionId) => state.sessions.includes(sessionId),
    refresh: () => {
      const before = JSON.stringify(state);
      const next = readPinnedItems(storageRef);
      const changed = before !== JSON.stringify(next);
      if (changed) emit(next);
      return changed;
    },
    /**
     * @param {string | { id?: string, path?: string } | null | undefined} idOrRecord
     * @param {string} [path]
     */
    pinWorkspace: (idOrRecord, path) => {
      const id = typeof idOrRecord === "object" ? idOrRecord?.id : idOrRecord;
      const workspacePath = typeof idOrRecord === "object" ? idOrRecord?.path : path;
      if (typeof id !== "string" || !id || typeof workspacePath !== "string" || !workspacePath)
        return { ok: false, error: "invalid", state: snapshot() };
      return mutate((current) => ({
        workspaces: [
          { id, path: workspacePath },
          ...current.workspaces.filter((item) => item.id !== id),
        ],
        sessions: current.sessions,
      }));
    },
    /** @param {string} id */
    unpinWorkspace: (id) =>
      mutate((current) => ({
        workspaces: current.workspaces.filter((item) => item.id !== id),
        sessions: current.sessions,
      })),
    /** @param {string} sessionId */
    pinSession: (sessionId) => {
      if (typeof sessionId !== "string" || !sessionId)
        return { ok: false, error: "invalid", state: snapshot() };
      return mutate((current) => ({
        workspaces: current.workspaces,
        sessions: [sessionId, ...current.sessions.filter((item) => item !== sessionId)],
      }));
    },
    /** @param {string} sessionId */
    unpinSession: (sessionId) =>
      mutate((current) => ({
        workspaces: current.workspaces,
        sessions: current.sessions.filter((item) => item !== sessionId),
      })),
    /** @param {{ fromId: string, toId: string, path?: string }} opts */
    reconcileWorkspace: ({ fromId, toId, path }) =>
      mutate((current) => {
        const index = current.workspaces.findIndex((item) => item.id === fromId);
        if (index < 0) return current;
        const workspaces = current.workspaces.slice();
        workspaces[index] = { id: toId, path: path || workspaces[index].path };
        return { workspaces, sessions: current.sessions };
      }),
    /**
     * @param {string} fromId
     * @param {string} toId
     */
    replaceWorkspaceId: (fromId, toId) =>
      mutate((current) => {
        const index = current.workspaces.findIndex((item) => item.id === fromId);
        if (index < 0) return current;
        const workspaces = current.workspaces.slice();
        workspaces[index] = { ...workspaces[index], id: toId };
        return { workspaces, sessions: current.sessions };
      }),
    refreshFromStorage,
    /** @param {(state: PinnedState) => void} listener */
    subscribe: (listener) => {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => {
      destroyed = true;
      windowRef?.removeEventListener?.("focus", onFocus);
      windowRef?.removeEventListener?.("visibilitychange", onVisibility);
      listeners.clear();
    },
  };
}
