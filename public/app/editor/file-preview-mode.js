// ABOUTME: Decides whether a preview tab can be edited and switches it between preview, edit, and diff.
// ABOUTME: Mode is stored on the tab; remounting the renderer and fetching the diff go through the panel.

import { classifyFilePath } from "./file-classify.js";

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel
 * @typedef {import("./file-preview-panel.js").FilePreviewTab} FilePreviewTab
 */

/** @param {FilePreviewTab | null | undefined} tab */
export function isTabEditable(tab) {
  if (
    !tab ||
    tab.content === null ||
    tab.editable === false ||
    tab.truncated ||
    tab.isBinary ||
    (tab.renderAs === "markdown" && classifyFilePath(tab.filePath).contentType === "convertible")
  ) {
    return false;
  }
  return classifyFilePath(tab.filePath).editable;
}

/** @param {FilePreviewTab | null | undefined} tab */
export function isConversionTab(tab) {
  return Boolean(tab && classifyFilePath(tab.filePath).contentType === "convertible");
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} mode
 */
export async function switchPreviewMode(panel, mode) {
  const tab = panel.state.getActiveTab();
  if (!tab || !["preview", "edit", "diff"].includes(mode)) return false;
  if (mode === "edit" && !isTabEditable(tab)) return false;
  if (mode === "diff" && !panel.gitDiffCache.has(tab.id))
    await panel._fetchGitDiff(tab.id, tab.filePath);
  if (mode === "diff" && panel.gitDiffCache.get(tab.id) == null) return false;
  if (tab.mode === mode) return true;
  panel._captureActiveRenderer();
  panel.state.updateTab(tab.id, { mode });
  panel.state.persist();
  const fresh = panel.state.getTab(tab.id);
  if (fresh) await panel._mountRenderer(fresh);
  return true;
}
