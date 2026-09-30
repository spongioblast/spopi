// ABOUTME: Pure model that turns a Pi session's native entry tree into render rows.
// ABOUTME: Pi owns the tree (id/parentId/leafId); this module only projects it for the Info panel.

/**
 * Session tree model — projection of Pi's authoritative session JSONL tree.
 *
 * Pi's session is a tree of entries linked by `id`/`parentId`, plus an
 * `active leaf` that Pi alone owns. This module NEVER derives, mutates, or
 * stores session state: it takes the entries + leafId exactly as Pi reported
 * them (`get_tree` / `get_entries`) and produces the ordered
 * rows the Info panel renders.
 *
 * Visibility rules (design: 2026-08-21 Info panel):
 * - Only `message` entries with role `user` or `assistant` render.
 * - Assistant nodes render when they have displayable text, or when
 *   `stopReason` is `error`/`aborted` (compact status node — failed history
 *   stays visible).
 * - Hidden entries (tool results, thinking, model changes, compaction,
 *   branch summaries, labels, …) are skipped visually only: parent/child
 *   links are computed over the FULL tree so visible nodes stay connected
 *   through hidden intermediates.
 *
 * Active/inactive rules:
 * - The active path is the ancestor chain of `leafId` over the full tree.
 * - Nodes on the active path render active (expanded, clickable).
 * - Every full-tree child of an active-path node that is NOT on the active
 *   path heads an inactive branch: rendered as a collapsed summary row with
 *   a turn count; expanded rows stay inactive and non-navigable; only
 *   full-tree leaves (no children at all) are resumable ("Resume branch").
 */

/**
 * @typedef {{ type?: string, text?: string }} ContentBlock
 * @typedef {{
 *   role?: string,
 *   content?: string | ContentBlock[],
 *   stopReason?: string | null,
 * }} SessionMessage
 * @typedef {{
 *   id: string,
 *   parentId?: string | null,
 *   type?: string,
 *   message?: SessionMessage,
 * }} SessionEntry
 * @typedef {{
 *   role: string,
 *   previewText: string,
 *   statusOnly?: boolean,
 *   stopReason?: string | null,
 *   hasImages?: boolean,
 * }} ClassifiedEntry
 * @typedef {{
 *   kind: "node",
 *   entryId: string,
 *   role: string,
 *   previewText: string,
 *   statusOnly: boolean,
 *   stopReason?: string | null,
 *   hasImages: boolean,
 *   depth: number,
 *   isActive: boolean,
 *   isCurrentLeaf: boolean,
 *   isFullLeaf: boolean,
 * }} TreeNodeRow
 * @typedef {{
 *   kind: "branch",
 *   entryId: string,
 *   previewText: string,
 *   depth: number,
 *   turnCount: number,
 *   rows: TreeRow[],
 * }} TreeBranchRow
 * @typedef {TreeNodeRow | TreeBranchRow} TreeRow
 */

const PREVIEW_MAX_CHARS = 200;

/**
 * Extract displayable text from a message content (string or block array).
 * @param {unknown} content
 * @returns {string}
 */
export function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  /** @type {ContentBlock[]} */
  const blocks = content;
  return blocks
    .filter((b) => b?.type === "text")
    .map((b) => b.text || "")
    .join("");
}

/**
 * Count image blocks (for image-only user messages).
 * @param {unknown} content
 * @returns {number}
 */
function imageCount(content) {
  if (!Array.isArray(content)) return 0;
  /** @type {ContentBlock[]} */
  const blocks = content;
  return blocks.filter((b) => b?.type === "image").length;
}

/**
 * First non-empty line, capped — the row preview. No summaries, no LLM.
 * @param {unknown} text
 * @returns {string}
 */
function firstLine(text) {
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, PREVIEW_MAX_CHARS);
  }
  return "";
}

/**
 * Visible-node classification per the design's role filter.
 * @param {SessionEntry | null | undefined} entry
 * @returns {ClassifiedEntry | null}
 */
function classifyEntry(entry) {
  if (entry?.type !== "message") return null;
  const message = entry.message;
  if (!message) return null;
  const role = message.role;
  if (role !== "user" && role !== "assistant") return null;
  const text = messageText(message.content);
  if (role === "assistant") {
    const failed = message.stopReason === "error" || message.stopReason === "aborted";
    if (!text && !failed) return null; // pure tool activity — hidden
    return {
      role,
      previewText: firstLine(text),
      statusOnly: !text && failed,
      stopReason: message.stopReason ?? null,
    };
  }
  const images = imageCount(message.content);
  if (!text && images === 0) return null;
  return { role, previewText: firstLine(text), hasImages: !text && images > 0 };
}

/**
 * Build the render model from Pi's authoritative entry list and active leaf id.
 *
 * @param {object} [options]
 * @param {SessionEntry[]} [options.entries]
 * @param {string | null} [options.leafId]
 * @returns {{ activePathIds: Set<string>, rows: TreeRow[] }} ordered
 *   top-level rows: `node` rows (active path, in order) interleaved with
 *   `branch` summary rows for inactive subtrees. Each branch row carries its
 *   full subtree rows so the view expands/collapses without rebuilding.
 */
export function buildSessionTree({ entries, leafId } = {}) {
  const list = Array.isArray(entries) ? entries : [];

  // Index the full tree. Orphans (broken parent chain) become roots, matching
  // pi's own getTree behavior.
  /** @type {Map<string, SessionEntry>} */
  const byId = new Map();
  for (const entry of list) {
    if (!entry || typeof entry.id !== "string") continue;
    byId.set(entry.id, entry);
  }
  /** @type {Map<string, SessionEntry[]>} */
  const childrenOf = new Map();
  /** @type {SessionEntry[]} */
  const roots = [];
  for (const entry of list) {
    if (!entry || typeof entry.id !== "string" || byId.get(entry.id) !== entry) continue;
    const parent = typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined;
    if (parent && parent !== entry) {
      const parentId = entry.parentId;
      if (typeof parentId !== "string") continue;
      const bucket = childrenOf.get(parentId) ?? [];
      bucket.push(entry);
      childrenOf.set(parentId, bucket);
    } else {
      roots.push(entry);
    }
  }

  // Active path: walk leaf → root over the FULL tree (hidden ancestors
  // included). Cycle-guarded; Pi-supplied leafId only, never derived.
  const activePathIds = new Set();
  if (typeof leafId === "string" && byId.has(leafId)) {
    let cursor = byId.get(leafId);
    while (cursor && !activePathIds.has(cursor.id)) {
      activePathIds.add(cursor.id);
      cursor = typeof cursor.parentId === "string" ? byId.get(cursor.parentId) : undefined;
    }
  }

  /** Visible children of a full-tree entry, bridging through hidden entries.
   * Cycle-guarded: malformed parent chains can loop. */
  // Only final assistant answers belong in Session history. Pi may persist
  // several assistant entries for one turn (thinking/tool work followed by a
  // final answer); identify the last text-bearing assistant before the next
  // visible user message without exposing process detail.
  const finalAssistantIds = new Set();
  /** @param {SessionEntry | null | undefined} entry */
  const isVisibleUser = (entry) => entry?.type === "message" && entry.message?.role === "user";
  /** @param {SessionEntry | null | undefined} entry */
  const isTextAssistant = (entry) => {
    if (entry?.type !== "message" || entry.message?.role !== "assistant") return false;
    const text = messageText(entry.message.content);
    return Boolean(text.trim());
  };
  /** @param {SessionEntry | null | undefined} entry */
  const markFinalAssistant = (entry) => {
    if (!entry || !isTextAssistant(entry)) return;
    const seen = new Set([entry.id]);
    /** @type {SessionEntry[]} */
    const stack = [...(childrenOf.get(entry.id) ?? [])];
    while (stack.length > 0) {
      const child = stack.pop();
      if (!child || seen.has(child.id)) continue;
      seen.add(child.id);
      if (isVisibleUser(child)) continue; // user bounds that path's turn; scan siblings
      if (isTextAssistant(child)) return;
      stack.push(...(childrenOf.get(child.id) ?? []));
    }
    finalAssistantIds.add(entry.id);
  };
  for (const entry of list) markFinalAssistant(entry);

  /**
   * @param {string | null} entryId
   * @returns {Array<{ entry: SessionEntry, cls: ClassifiedEntry }>}
   */
  const visibleChildren = (entryId) => {
    /** @type {Array<{ entry: SessionEntry, cls: ClassifiedEntry }>} */
    const out = [];
    const seen = new Set();
    /** @param {string} id */
    const walk = (id) => {
      for (const child of childrenOf.get(id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        const cls = classifyEntry(child);
        if (
          cls &&
          (cls.role !== "assistant" || cls.statusOnly || finalAssistantIds.has(child.id))
        ) {
          out.push({ entry: child, cls });
        } else {
          walk(child.id);
        }
      }
    };
    if (entryId === null) {
      for (const root of roots) {
        if (seen.has(root.id)) continue;
        seen.add(root.id);
        const cls = classifyEntry(root);
        if (cls && (cls.role !== "assistant" || cls.statusOnly || finalAssistantIds.has(root.id))) {
          out.push({ entry: root, cls });
        } else {
          walk(root.id);
        }
      }
    } else {
      walk(entryId);
    }
    return out;
  };

  // Hidden process entries do not make a visible message non-terminal. A
  // final answer followed only by tool bookkeeping is still a resumable leaf;
  // a later visible user/assistant node keeps it on the branch spine.
  /** @param {string} entryId */
  const hasVisibleChildren = (entryId) => visibleChildren(entryId).length > 0;

  /**
   * Turn count of an inactive subtree INCLUDING its head: user message
   * entries, hidden or not. The divergent prompt itself is a turn.
   * @param {SessionEntry | null | undefined} headEntry
   * @param {string} entryId
   * @returns {number}
   */
  const turnCount = (headEntry, entryId) => {
    let count = headEntry?.type === "message" && headEntry.message?.role === "user" ? 1 : 0;
    /** @type {string[]} */
    const stack = [entryId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (typeof id !== "string") continue;
      for (const child of childrenOf.get(id) ?? []) {
        if (child?.type === "message" && child.message?.role === "user") count += 1;
        stack.push(child.id);
      }
    }
    return count;
  };

  /**
   * @param {SessionEntry} entry
   * @param {ClassifiedEntry} cls
   * @param {number} depth
   * @param {boolean} isActive
   * @returns {TreeNodeRow}
   */
  const nodeRow = (entry, cls, depth, isActive) => ({
    kind: "node",
    entryId: entry.id,
    role: cls.role,
    previewText: cls.previewText,
    statusOnly: Boolean(cls.statusOnly),
    stopReason: cls.stopReason,
    hasImages: Boolean(cls.hasImages),
    // Linear paths are flat in the UI. Branch containers provide the only
    // visual nesting; parentId remains authoritative data, not indentation.
    depth: isActive ? 0 : depth,
    isActive,
    isCurrentLeaf: entry.id === leafId,
    isFullLeaf: !hasVisibleChildren(entry.id),
  });

  /**
   * Rows for a whole inactive subtree headed by `head` (a visible entry off
   * the active path). The head's spine renders inline as a linear chain;
   * only a genuine fork inside the dead subtree (a node with ≥2 visible
   * children) splits into nested collapsed summaries — leaf children stay
   * inline, deeper children become their own branch rows. Cycle-guarded.
   * @param {SessionEntry} head
   * @param {ClassifiedEntry} headCls
   * @param {number} depth
   * @returns {TreeBranchRow}
   */
  const branchRow = (head, headCls, depth) => {
    /** @type {TreeRow[]} */
    const subRows = [nodeRow(head, headCls, depth + 1, false)];
    const seen = new Set([head.id]);
    let current = head;
    let d = depth + 1;
    for (;;) {
      const kids = visibleChildren(current.id).filter(({ entry }) => !seen.has(entry.id));
      if (kids.length === 0) break;
      for (const { entry } of kids) seen.add(entry.id);
      if (kids.length === 1) {
        const { entry: kid, cls } = kids[0];
        d += 1;
        subRows.push(nodeRow(kid, cls, d, false));
        current = kid;
        continue;
      }
      for (const { entry: kid, cls } of kids) {
        if (hasVisibleChildren(kid.id)) subRows.push(branchRow(kid, cls, d));
        else subRows.push(nodeRow(kid, cls, d + 1, false));
      }
      break;
    }
    return {
      kind: "branch",
      entryId: head.id, // fork head — the summary row anchors here
      previewText: headCls.previewText,
      depth,
      turnCount: turnCount(head, head.id),
      rows: subRows,
    };
  };

  // Top level: active-path roots walk inline; anything else becomes a branch.
  /** @type {TreeRow[]} */
  const rows = [];
  /**
   * @param {string | null} entryId
   * @param {number} depth
   */
  const walkActive = (entryId, depth) => {
    for (const { entry, cls } of visibleChildren(entryId)) {
      if (activePathIds.has(entry.id)) {
        rows.push(nodeRow(entry, cls, depth, true));
        walkActive(entry.id, depth + 1);
      } else {
        rows.push(branchRow(entry, cls, depth));
      }
    }
  };
  walkActive(null, 0);

  return { activePathIds, rows };
}

/**
 * Inactive full-tree leaves inside a branch row (candidates for Resume),
 * recursing into nested branch summaries. Order: DFS as rendered.
 * @param {TreeRow | null | undefined} branchRowData
 * @returns {string[]}
 */
export function branchLeafIds(branchRowData) {
  if (branchRowData?.kind !== "branch") return [];
  /** @type {string[]} */
  const out = [];
  for (const row of branchRowData.rows ?? []) {
    if (row.kind === "node" && row.isFullLeaf) out.push(row.entryId);
    else if (row.kind === "branch") out.push(...branchLeafIds(row));
  }
  return out;
}
