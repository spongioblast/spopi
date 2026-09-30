// ABOUTME: Session tree and Context as ext-tabs on the file preview tab bar.
// ABOUTME: Same hook later hosts ctx.ui.custom() panels; never opens in chat.

import { registerSessionTree } from "../session/session-tree-host.js";
import { mountSessionTree } from "../session/session-tree-tab.js";
import { filePreviewRefs } from "../shell/chrome/file-preview.js";

/**
 * @param {string} id
 * @param {string} label
 * @param {HTMLElement} node
 * @param {object} [options]
 * @param {Element | null | undefined} [options.tabBar]
 * @param {Element | null | undefined} [options.preview]
 */
function openCustomTab(id, label, node, { tabBar, preview } = {}) {
  const refs = filePreviewRefs();
  const bar = tabBar || refs.tabs;
  const pane = preview || refs.panel;
  if (!bar || !node) return null;
  node.hidden = false;
  node.classList.add("spopi-custom-tab-body");
  if (pane && node.parentElement !== pane.parentElement) {
    pane.parentElement?.insertBefore(node, pane.nextSibling);
  }
  /** @type {HTMLElement | null} */
  let tab = /** @type {HTMLElement | null} */ (bar.querySelector(`[data-custom-tab="${id}"]`));
  if (!tab) {
    tab = document.createElement("div");
    tab.className = "file-preview-tab ext-tab";
    tab.dataset.customTab = id;
    const name = document.createElement("span");
    name.className = "file-preview-tab-name";
    name.textContent = label;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "file-preview-tab-close";
    close.title = "Close";
    close.textContent = "×";
    const tabEl = tab;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      tabEl.remove();
      node.hidden = true;
      pane?.classList.remove("custom-tab-active");
      const remaining = bar.querySelectorAll(".file-preview-tab");
      if (!remaining.length) {
        pane?.classList.add("collapsed");
        return;
      }
      const next = /** @type {HTMLElement} */ (remaining[remaining.length - 1]);
      if (next.dataset.customTab) {
        activateCustomTab(next.dataset.customTab, { tabBar: bar, preview: pane });
      } else next.click();
    });
    tab.append(name, close);
    tab.addEventListener("click", () => activateCustomTab(id, { tabBar: bar, preview: pane }));
    bar.appendChild(tab);
  }
  activateCustomTab(id, { tabBar: bar, preview: pane });
  return tab;
}

/**
 * @param {string} id
 * @param {object} [options]
 * @param {Element | null | undefined} [options.tabBar]
 * @param {Element | null | undefined} [options.preview]
 */
function activateCustomTab(id, { tabBar, preview } = {}) {
  const refs = filePreviewRefs();
  const bar = tabBar || refs.tabs;
  const pane = preview || refs.panel;
  pane?.classList.remove("collapsed");
  pane?.classList.add("custom-tab-active");
  for (const other of bar?.querySelectorAll(".file-preview-tab") || []) {
    const el = /** @type {HTMLElement} */ (other);
    el.classList.toggle("active", el.dataset.customTab === id);
  }
  for (const body of document.querySelectorAll(".spopi-custom-tab-body")) {
    const el = /** @type {HTMLElement} */ (body);
    el.hidden = el.id !== `spopi-dock-${id}` && el.dataset.customTab !== id;
  }
}

/**
 * @param {Element | null | undefined} paneCenter
 * @param {object} [options]
 * @param {(key: string) => string} [options.t]
 * @param {((text: string) => void) | undefined} [options.sendPrompt]
 * @param {((target: unknown) => void) | undefined} [options.onNavigate]
 */
export function mountCenterTabs(paneCenter, { t = (key) => key, sendPrompt, onNavigate } = {}) {
  if (!paneCenter) return null;
  const existingTree = document.getElementById("spopi-dock-session-tree");
  const tree = existingTree ? /** @type {HTMLElement} */ (existingTree) : panel("session-tree");
  const existingContext = document.getElementById("spopi-dock-context");
  const context = existingContext ? /** @type {HTMLElement} */ (existingContext) : panel("context");
  tree.dataset.customTab = "session-tree";
  context.dataset.customTab = "context";
  tree.hidden = true;
  context.hidden = true;
  paneCenter.append(tree, context);
  // get_tree paints this panel. The tab stays closed until something opens it.
  const showTree = () => openCustomTab("session-tree", t("sessionTree.title"), tree);
  /**
   * @param {unknown} snapshot
   * @param {{ open?: boolean }} [paintOptions]
   */
  const paintTree = (snapshot, { open = false } = {}) => {
    mountSessionTree(tree, { tree: snapshot, onNavigate, t });
    if (open) showTree();
  };
  registerSessionTree({ paint: paintTree, show: showTree });
  return {
    tree,
    context,
    openTree: () => {
      showTree();
      return tree;
    },
    openContext: () => openCustomTab("context", t("contextInspector.title"), context),
    openCustomTab,
    sendPrompt,
    onNavigate,
  };
}

/**
 * @param {string} id
 * @returns {HTMLDivElement}
 */
function panel(id) {
  const node = document.createElement("div");
  node.id = `spopi-dock-${id}`;
  node.className = "spopi-workbench-panel";
  return node;
}
