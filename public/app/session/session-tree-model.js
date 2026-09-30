// ABOUTME: Flatten Pi get_tree / branch_summary payloads for the session tree center tab.
// ABOUTME: The host sends those payloads; this module does not call the network.

/**
 * @typedef {{
 *   id: string,
 *   parentId: string | null,
 *   depth: number,
 *   label: string,
 *   branch: string | null,
 *   type: string,
 *   children: number,
 *   role?: string,
 *   text?: string,
 *   leaf?: boolean,
 * }} FlatTreeNode
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "",
    )
    .join("");
}

/**
 * @typedef {{
 *   id?: string,
 *   entryId?: string,
 *   hash?: string,
 *   summary?: string,
 *   label?: string,
 *   branch?: string,
 *   branchId?: string,
 *   type?: string,
 *   role?: string,
 *   children?: Array<unknown>,
 *   tree?: Array<unknown>,
 *   leafId?: string | null,
 *   entry?: { id?: string, type?: string, role?: string, summary?: string, message?: { role?: string, content?: unknown } },
 * }} TreeInput
 */

/**
 * @param {unknown} node
 * @param {string | null} [parentId]
 * @param {number} [depth]
 * @param {Array<FlatTreeNode>} [acc]
 * @param {string | null} [leafId]
 * @returns {Array<FlatTreeNode>}
 */
export function flattenTree(node, parentId = null, depth = 0, acc = [], leafId = null) {
  if (!node || typeof node !== "object") return acc;
  const record = /** @type {TreeInput} */ (node);
  if (Array.isArray(record.tree)) {
    const current = typeof record.leafId === "string" ? record.leafId : leafId;
    for (const child of record.tree) flattenTree(child, null, 0, acc, current);
    return acc;
  }
  const entry =
    record.entry && typeof record.entry === "object"
      ? /** @type {NonNullable<TreeInput["entry"]>} */ (record.entry)
      : null;
  const id = entry?.id || record.id || record.entryId || record.hash || `node-${acc.length}`;
  const role = entry?.message?.role || entry?.role || record.role || "";
  const text = textOf(entry?.message?.content) || record.summary || "";
  const label =
    (typeof record.label === "string" && record.label) ||
    entry?.summary ||
    record.summary ||
    text ||
    record.id ||
    id;
  acc.push({
    id,
    parentId,
    depth,
    label,
    branch: record.branch || record.branchId || null,
    type: entry?.type || record.type || (role === "user" ? "user" : "assistant"),
    children: Array.isArray(record.children) ? record.children.length : 0,
    role,
    text,
    leaf: Boolean(leafId && id === leafId),
  });
  for (const child of record.children || []) {
    flattenTree(child, id, depth + 1, acc, leafId);
  }
  return acc;
}

/**
 * @param {string | null | undefined} [modelId]
 * @returns {string}
 */
export function retryWithModelCommand(modelId) {
  const id = String(modelId || "").trim();
  return id ? `/model ${id}` : "/model";
}

/**
 * @param {string} entryId
 * @returns {{ type: string, entryId: string, targetId: string }}
 */
export function navigateTreePayload(entryId) {
  return { type: "navigate_tree", entryId, targetId: entryId };
}
