// ABOUTME: Opens, selects, and closes file preview tabs, loading or remounting content as the active tab changes.
// ABOUTME: Tab data lives in FileTabState; loading, mounting, and dirty settlement go through the panel.

import { normalizeLocalPath } from "../files/path-utils.js";
import { classifyFilePath } from "./file-classify.js";
import { abortPreviewGitDiff } from "./file-preview-git-diff.js";
import { isConversionTab } from "./file-preview-mode.js";
import { leadTabs, leaveLeadTab } from "./lead-tab.js";

/** @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel */

/**
 * @param {FilePreviewPanel} panel
 * @param {string} filePath
 * @param {{ mode?: string, line?: number | string, [key: string]: unknown }} metadata
 */
export async function openPreviewFile(panel, filePath, metadata) {
  leaveLeadTab();
  const normalizedPath = normalizeLocalPath(filePath);
  const existing = panel.state.getTabs().find((tab) => tab.filePath === normalizedPath);
  const currentTab = panel.state.getActiveTab();

  if (existing) {
    if (metadata.mode === "diff") panel.state.updateTab(existing.id, { mode: "diff" });
    if (metadata.mode === "diff") void panel._fetchGitDiff(existing.id, existing.filePath);
    if (currentTab?.id !== existing.id) {
      if (isConversionTab(currentTab)) panel._abortTabLoad(currentTab?.id);
      panel._captureActiveRenderer();
      panel.state.selectTab(existing.id);
      if (existing.content === null && existing.loading) {
        panel._abortTabLoad(existing.id);
        panel.state.updateTab(existing.id, { loading: false, error: null, errorDetail: null });
      }
    }
    panel.activeContent = { kind: "file", id: existing.id };
    panel._openPanel();
    panel._renderTabBar();
    const freshExisting = panel.state.getTab(existing.id);
    if (freshExisting?.content === null && !freshExisting.loading) {
      await panel._loadTabContent(freshExisting);
    } else if (currentTab?.id !== existing.id || !panel.currentRenderer) {
      await panel._mountRenderer(freshExisting);
    }
    revealLine(panel, metadata.line);
    return existing;
  }

  if (isConversionTab(currentTab)) panel._abortTabLoad(currentTab?.id);
  panel._captureActiveRenderer();
  const defaultMode =
    metadata.mode ?? (classifyFilePath(normalizedPath).contentType === "text" ? "edit" : "preview");
  const tab = panel.state.openFile(normalizedPath, { ...metadata, mode: defaultMode });
  if (metadata.mode === "diff") void panel._fetchGitDiff(tab.id, tab.filePath);
  panel.activeContent = { kind: "file", id: tab.id };
  panel._openPanel();
  panel._renderTabBar();
  await panel._loadTabContent(tab);
  revealLine(panel, metadata.line);
  return tab;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {number | string | null | undefined} line
 */
function revealLine(panel, line) {
  const lineNumber = Number(line);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return false;
  return panel.currentRenderer?.goToLine?.(lineNumber) ?? false;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 */
export async function selectPreviewTab(panel, tabId) {
  const currentTab = panel.state.getActiveTab();
  if (currentTab?.id === tabId) {
    if (!panel.currentRenderer) {
      const tab = panel.state.getTab(tabId);
      if (tab) await panel._mountRenderer(tab);
    }
    panel.activeContent = { kind: "file", id: tabId };
    return true;
  }
  if (isConversionTab(currentTab)) panel._abortTabLoad(currentTab?.id);
  panel._captureActiveRenderer();
  if (!panel.state.selectTab(tabId)) return false;

  const tab = panel.state.getTab(tabId);
  if (!tab) return false;
  if (tab.content === null && !tab.loading) {
    await panel._loadTabContent(tab);
  } else {
    await panel._mountRenderer(tab);
  }
  panel.activeContent = { kind: "file", id: tabId };
  return true;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 */
export async function closePreviewTab(panel, tabId) {
  const tab = panel.state.getTab(tabId);
  if (!tab) return false;
  if (tab.id === panel.state.activeTabId) panel._captureActiveRenderer();

  const freshTab = panel.state.getTab(tabId);
  if (freshTab?.dirty) {
    const settled = await panel._settleDirtyTabs([freshTab], "tab");
    if (!settled) return false;
  }

  panel._clearAutoSave(tabId);
  panel._abortTabLoad(tabId);
  abortPreviewGitDiff(panel, tabId);
  panel.gitDiffCache.delete(tabId);
  panel.loadTokens.delete(tabId);
  const wasActive = panel.state.activeTabId === tabId;
  if (wasActive) panel._destroyRenderer();
  const result = panel.state.closeTab(tabId);
  if (!result.closed) return false;

  if (result.nextTabId) {
    const nextTab = panel.state.getTab(result.nextTabId);
    if (nextTab?.content === null && !nextTab.loading) {
      await panel._loadTabContent(nextTab);
    } else if (wasActive && nextTab) {
      await panel._mountRenderer(nextTab);
    }
    if (wasActive) {
      const nextFocus = Array.from(panel.tabBar?.querySelectorAll("[data-tab-id]") || []).find(
        (node) => {
          if (!("dataset" in node)) return false;
          const dataset = /** @type {DOMStringMap} */ (node.dataset);
          return dataset.tabId === result.nextTabId;
        },
      );
      if (nextFocus && "focus" in nextFocus && typeof nextFocus.focus === "function") {
        nextFocus.focus();
      }
    }
  } else {
    panel._closePanel();
    const lead = leadTabs().at(-1)?.[1];
    if (lead) lead.onSelect();
    else if (wasActive) panel.fileSidebarToggle?.focus();
  }
  return true;
}
