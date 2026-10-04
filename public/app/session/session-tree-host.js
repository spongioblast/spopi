// ABOUTME: Holds the session tree panel and the latest get_tree snapshot.
// ABOUTME: One model feeds the Info sidebar, the tree tab, and session switch.

/** @type {{ paint: (tree: unknown, options?: { open?: boolean }) => void, show: () => void } | null} */
let host = null;
/** @type {string} */
let leafId = "";
let summarizeNext = false;
/** @type {((entryId: string, text: string) => void) | null} */
let editHandler = null;
/** @type {object | null} */
let lastCtx = null;
/** @type {ReturnType<typeof createSessionTreeModel> | null} */
let model = null;

/**
 * @typedef {{ id?: string, parentId?: string | null, type?: string, message?: Record<string, unknown> }} TreeEntry
 * @typedef {{ tree: unknown[], entries: TreeEntry[], leafId: string | null, lastEntryId: string, gap?: boolean }} TreeSnapshot
 * @typedef {{
 *   request: (cmd: { type: string, since?: string }, target?: unknown) => Promise<unknown>,
 *   getTarget: () => unknown,
 * }} TreeModelDeps
 */

/**
 * @param {{ paint: (tree: unknown, options?: { open?: boolean }) => void, show: () => void }} next
 */
export function registerSessionTree(next) {
  host = next;
}

/** @param {(entryId: string, text: string) => void} handler */
export function registerTreeEdit(handler) {
  editHandler = handler;
}

export function markSummarizeNavigate() {
  summarizeNext = true;
}

export function consumeSummarizeNavigate() {
  const value = summarizeNext;
  summarizeNext = false;
  return value;
}

export function currentTreeLeaf() {
  return model?.snapshot().leafId || leafId;
}

/**
 * @param {string} entryId
 * @param {string} text
 */
export function editFromTree(entryId, text) {
  editHandler?.(entryId, text);
}

/**
 * @param {TreeModelDeps} deps
 */
export function startSessionTreeModel(deps) {
  model = createSessionTreeModel(deps);
  return model;
}

export function sessionTreeModel() {
  return model;
}

export function resyncSessionTree() {
  return model?.resync() ?? Promise.resolve(null);
}

/**
 * @param {unknown} entry
 */
export function applyTreeAppend(entry) {
  const next = model?.applyAppended(entry);
  if (next?.gap) return model?.resync();
  if (next) paintSnapshot(next, { open: false });
  return next;
}

/**
 * @param {object} ctx
 * @param {{ open?: boolean }} [options]
 */
export async function refreshSessionTree(ctx, { open = false } = {}) {
  lastCtx = ctx;
  const bag =
    /** @type {{ runtime?: { request?: TreeModelDeps["request"] }, getTarget?: () => unknown, sessionRuntime?: { dispatch?: (action: { type: string, tree?: unknown }) => void } }} */ (
      ctx
    );
  if (!model && bag.runtime?.request && bag.getTarget) {
    startSessionTreeModel({
      request: (cmd, target) => bag.runtime?.request?.(cmd, target) ?? Promise.resolve(null),
      getTarget: () => bag.getTarget?.(),
    });
  }
  try {
    const snapshot = await model?.load();
    if (!snapshot) return;
    leafId = snapshot.leafId || "";
    bag.sessionRuntime?.dispatch?.({ type: "tree", tree: snapshot });
    paintSnapshot(snapshot, { open });
  } catch {
    // Keep the last tree when the session has no snapshot yet.
  }
}

export function openRegisteredTree() {
  if (lastCtx) return refreshSessionTree(lastCtx, { open: true });
  host?.show();
}

/**
 * @param {TreeModelDeps} deps
 */
export function createSessionTreeModel({ request, getTarget }) {
  /** @type {unknown[]} */
  let tree = [];
  /** @type {TreeEntry[]} */
  let entries = [];
  /** @type {string | null} */
  let activeLeaf = null;
  /** @type {string} */
  let lastEntryId = "";
  /** @type {Set<(snapshot: TreeSnapshot) => void>} */
  const listeners = new Set();

  function snapshot() {
    return { tree, entries, leafId: activeLeaf, lastEntryId, gap: false };
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  /**
   * @param {unknown} result
   */
  function dataOf(result) {
    if (!result || typeof result !== "object" || !("response" in result)) return null;
    const data = /** @type {{ response?: { success?: boolean, data?: unknown } }} */ (result)
      .response;
    if (data?.success === false || !data?.data || typeof data.data !== "object") return null;
    return /** @type {{ tree?: unknown[], entries?: TreeEntry[], leafId?: string | null }} */ (
      data.data
    );
  }

  /**
   * @param {{ tree?: unknown[], entries?: TreeEntry[], leafId?: string | null }} data
   */
  function store(data) {
    tree = Array.isArray(data.tree) ? data.tree : tree;
    entries = Array.isArray(data.entries) ? data.entries : flatten(tree);
    activeLeaf =
      typeof data.leafId === "string" ? data.leafId : data.leafId === null ? null : activeLeaf;
    const last = entries.at(-1);
    lastEntryId = typeof last?.id === "string" ? last.id : lastEntryId;
    leafId = activeLeaf || "";
    emit();
    return snapshot();
  }

  async function load() {
    const data = dataOf(await request({ type: "get_tree" }, getTarget()));
    if (!data || !Array.isArray(data.tree)) throw new Error("get_tree failed");
    return store({ tree: data.tree, leafId: data.leafId ?? null });
  }

  /**
   * @param {unknown} entry
   * @param {{ silent?: boolean }} [options]
   */
  function applyAppended(entry, { silent = false } = {}) {
    if (!entry || typeof entry !== "object") return snapshot();
    const next = /** @type {TreeEntry} */ (entry);
    if (typeof next.id !== "string") return snapshot();
    if (entries.some((item) => item.id === next.id)) return snapshot();
    const parentId = typeof next.parentId === "string" ? next.parentId : "";
    if (parentId && entries.length && !entries.some((item) => item.id === parentId)) {
      return { ...snapshot(), gap: true };
    }
    entries = [...entries, next];
    lastEntryId = next.id;
    tree = attach(tree, next);
    if (!silent) emit();
    return snapshot();
  }

  async function resync() {
    if (!lastEntryId) return load();
    try {
      const data = dataOf(await request({ type: "get_entries", since: lastEntryId }, getTarget()));
      if (!data || !Array.isArray(data.entries)) throw new Error("gap");
      for (const entry of data.entries) {
        const applied = applyAppended(entry, { silent: true });
        if (applied.gap) throw new Error("unknown parent");
      }
      activeLeaf = typeof data.leafId === "string" ? data.leafId : activeLeaf;
      leafId = activeLeaf || "";
      emit();
      return snapshot();
    } catch {
      return load();
    }
  }

  /**
   * @param {string} [id]
   * @returns {TreeEntry[]}
   */
  function getBranch(id) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    /** @type {TreeEntry[]} */
    const chain = [];
    const seen = new Set();
    let current = id || activeLeaf || "";
    while (current && !seen.has(current)) {
      seen.add(current);
      const entry = byId.get(current);
      if (!entry) break;
      chain.push(entry);
      current = typeof entry.parentId === "string" ? entry.parentId : "";
    }
    chain.reverse();
    return chain;
  }

  /**
   * @param {(snapshot: TreeSnapshot) => void} listener
   */
  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function dispose() {
    listeners.clear();
    tree = [];
    entries = [];
    activeLeaf = null;
    lastEntryId = "";
  }

  return { load, applyAppended, resync, getBranch, subscribe, dispose, snapshot };
}

/**
 * @param {TreeSnapshot} snapshot
 * @param {{ open?: boolean }} options
 */
function paintSnapshot(snapshot, options) {
  host?.paint({ tree: snapshot.tree, leafId: snapshot.leafId }, options);
}

/**
 * Messages on the active branch. get_tree nodes carry the message body.
 *
 * @param {string} [id]
 */
export function branchMessages(id) {
  const current = model;
  if (!current) return [];
  return current.getBranch(id).flatMap((entry) => {
    if (entry.type !== "message" || !entry.message) return [];
    return [{ ...entry.message, entryId: entry.id }];
  });
}

/**
 * @param {unknown[]} nodes
 * @param {TreeEntry[]} [out]
 */
function flatten(nodes, out = []) {
  for (const node of nodes || []) {
    const item = /** @type {{ entry?: TreeEntry, children?: unknown[] }} */ (node);
    if (item?.entry && typeof item.entry === "object") out.push(item.entry);
    if (Array.isArray(item?.children)) flatten(item.children, out);
  }
  return out;
}

/**
 * @param {unknown[]} nodes
 * @param {TreeEntry} entry
 * @returns {unknown[]}
 */
function attach(nodes, entry) {
  /** @type {unknown[]} */
  const next = nodes.map((node) => {
    const item = /** @type {{ entry?: TreeEntry, children?: unknown[] }} */ (node);
    if (item?.entry?.id && item.entry.id === entry.parentId) {
      return { ...item, children: [...(item.children || []), { entry, children: [] }] };
    }
    return {
      ...item,
      children: Array.isArray(item?.children) ? attach(item.children, entry) : item?.children,
    };
  });
  if (!entry.parentId) next.push({ entry, children: [] });
  return next;
}
