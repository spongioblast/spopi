// ABOUTME: Fetches and caches the git diff of a preview tab's file, one in-flight request per tab.
// ABOUTME: The diff renderer draws the cached patch; the panel decides when to refetch or drop it.

/** @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel */

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 */
export function abortPreviewGitDiff(panel, tabId) {
  const ctrl = panel.gitDiffControllers.get(tabId);
  if (ctrl) {
    ctrl.abort();
    panel.gitDiffControllers.delete(tabId);
  }
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 * @param {string} filePath
 */
export async function fetchPreviewGitDiff(panel, tabId, filePath) {
  abortPreviewGitDiff(panel, tabId);
  const ctrl = new AbortController();
  panel.gitDiffControllers.set(tabId, ctrl);
  try {
    const res = await panel.fileApi?.readGitDiff?.(filePath, { signal: ctrl.signal });
    if (!res) {
      panel.gitDiffCache.set(tabId, null);
      return;
    }
    if (!res.ok) {
      panel.gitDiffCache.set(tabId, null);
      return;
    }
    const data = await res.json();
    if (!data.supported) {
      panel.gitDiffCache.set(tabId, null);
      return;
    }
    panel.gitDiffCache.set(tabId, data);
  } catch (e) {
    const errName =
      e && typeof e === "object" && "name" in e
        ? String(/** @type {{ name?: unknown }} */ (e).name)
        : "";
    if (errName !== "AbortError") panel.gitDiffCache.set(tabId, null);
    return;
  } finally {
    if (panel.gitDiffControllers.get(tabId) === ctrl) panel.gitDiffControllers.delete(tabId);
  }
  panel._renderToolbar();
  const activeTab = panel.state.getActiveTab();
  if (activeTab?.id === tabId && activeTab?.mode === "diff") {
    const tab = panel.state.getTab(tabId);
    if (tab) await panel._mountRenderer(tab);
  }
}
