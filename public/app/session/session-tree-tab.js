// ABOUTME: Center-tab view over Pi get_tree / navigate_tree / fork / branch_summary.
// ABOUTME: The tree shape comes from session-tree-model.js.

import { editFromTree, markSummarizeNavigate } from "./session-tree-host.js";
import { flattenTree, navigateTreePayload, retryWithModelCommand } from "./session-tree-model.js";

/**
 * @param {HTMLElement | null | undefined} root
 * @param {object} [options]
 * @param {unknown} [options.tree]
 * @param {(payload: { type: string, entryId: string, targetId: string }) => void} [options.onNavigate]
 * @param {(entryId: string, text: string) => void} [options.onEdit]
 * @param {(command: string) => void} [options.onRetryModel]
 * @param {(key: string, params?: Record<string, unknown>) => string} [options.t]
 * @returns {HTMLElement | null}
 */
export function mountSessionTree(
  root,
  { tree, onNavigate, onEdit = editFromTree, onRetryModel, t = (key) => key } = {},
) {
  if (!root) return null;
  root.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = t("sessionTree.title");
  root.append(heading);
  const list = document.createElement("div");
  list.className = "session-tree-list";
  root.append(list);
  renderLevel(list, flattenTree(tree), 0, { onNavigate, onEdit, t });
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "ui-button";
  retry.textContent = t("sessionTree.retryOtherModel");
  retry.addEventListener("click", () => onRetryModel?.(retryWithModelCommand()));
  root.append(retry);
  return root;
}

/**
 * @param {HTMLElement} parent
 * @param {import("./session-tree-model.js").FlatTreeNode[]} nodes
 * @param {number} index
 * @param {{ onNavigate?: (payload: { type: string, entryId: string, targetId: string }) => void, onEdit?: (entryId: string, text: string) => void, t: (key: string) => string }} hooks
 * @returns {number}
 */
function renderLevel(parent, nodes, index, hooks) {
  const depth = nodes[index]?.depth ?? 0;
  while (index < nodes.length && nodes[index].depth === depth) {
    const node = nodes[index];
    index += 1;
    const row = document.createElement("div");
    row.className = "session-tree-row";
    row.style.setProperty("--depth", String(node.depth));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-tree-node";
    if (node.leaf) button.classList.add("session-tree-leaf");
    button.textContent = node.label;
    button.addEventListener("click", () => hooks.onNavigate?.(navigateTreePayload(node.id)));
    row.append(button);
    if (node.role === "user") {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "session-tree-edit";
      edit.textContent = hooks.t("sessionTree.editFromHere");
      edit.addEventListener("click", () => hooks.onEdit?.(node.id, node.text || node.label));
      row.append(edit);
    }
    if (node.children > 0) {
      const summarize = document.createElement("button");
      summarize.type = "button";
      summarize.className = "session-tree-summarize";
      summarize.textContent = hooks.t("sessionTree.summarize");
      summarize.addEventListener("click", () => {
        markSummarizeNavigate();
        hooks.onNavigate?.(navigateTreePayload(node.id));
      });
      row.append(summarize);
    }
    parent.append(row);
    if (node.children > 0 && nodes[index] && nodes[index].depth > depth) {
      const branch = document.createElement("div");
      branch.className = "session-tree-children";
      parent.append(branch);
      index = renderLevel(branch, nodes, index, hooks);
    }
  }
  return index;
}
