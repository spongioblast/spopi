// ABOUTME: Saves preview tabs to disk: auto-save timers, one save per tab at a time, mtime conflicts, reload.
// ABOUTME: Also settles dirty tabs before they are closed; the dialogs that ask the user live elsewhere.

import { t } from "../i18n/i18n.js";
import { writeFile } from "../transport/workspace-http.js";
import { isTabEditable } from "./file-preview-mode.js";
import { applyNewlineStyle, normalizeNewlines } from "./file-text.js";

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel
 * @typedef {import("./file-preview-panel.js").FilePreviewTab} FilePreviewTab
 * @typedef {{ autoSave?: boolean, force?: boolean }} SaveOptions
 */

const AUTO_SAVE_DELAY = 1500;

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 */
export function scheduleAutoSave(panel, tabId) {
  const tab = panel.state.getTab(tabId);
  if (!panel.autoSaveEnabled || !tab?.dirty || tab.conflict || !isTabEditable(tab)) return;
  clearAutoSave(panel, tabId);
  const timer = setTimeout(() => {
    panel.autoSaveTimers.delete(tabId);
    void panel._saveTab(tabId, { autoSave: true });
  }, AUTO_SAVE_DELAY);
  panel.autoSaveTimers.set(tabId, timer);
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 */
export function clearAutoSave(panel, tabId) {
  const timer = panel.autoSaveTimers.get(tabId);
  clearTimeout(timer);
  panel.autoSaveTimers.delete(tabId);
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 * @param {SaveOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function saveTab(panel, tabId, options = {}) {
  const inFlight = panel.savePromises.get(tabId);
  if (inFlight) {
    await inFlight;
    const tab = panel.state.getTab(tabId);
    if (tab?.dirty && !tab.conflict) return panel._saveTab(tabId, options);
    return Boolean(tab && !tab.dirty);
  }

  const operation = performSave(panel, tabId, options);
  panel.savePromises.set(tabId, operation);
  try {
    return await operation;
  } finally {
    if (panel.savePromises.get(tabId) === operation) panel.savePromises.delete(tabId);
  }
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 * @param {SaveOptions} [options]
 * @returns {Promise<boolean>}
 */
async function performSave(panel, tabId, { autoSave = false, force = false } = {}) {
  const tab = panel.state.getTab(tabId);
  if (!tab?.dirty) return true;
  if (!isTabEditable(tab)) return false;

  if (tab.conflict && !force) {
    if (autoSave) return false;
    return resolveSaveConflict(panel, tabId);
  }

  const savedContent = normalizeNewlines(tab.content);
  const writtenContent = applyNewlineStyle(
    savedContent,
    /** @type {FilePreviewTab} */ (tab).newlineStyle ?? "\n",
  );
  const expectedMtimeMs = tab.mtimeMs;
  panel.state.updateTab(tabId, { saving: true, saveError: null });

  try {
    const res = panel.fileApi?.writeFileContent
      ? await panel.fileApi.writeFileContent({
          path: tab.filePath,
          content: writtenContent,
          expectedMtimeMs,
          force,
        })
      : await writeFile({
          path: tab.filePath,
          content: writtenContent,
          expectedMtimeMs: expectedMtimeMs ?? undefined,
          force,
        });

    if (res.status === 409) {
      panel.state.updateTab(tabId, { saving: false, conflict: true });
      if (autoSave) return false;
      return resolveSaveConflict(panel, tabId);
    }
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      panel.state.updateTab(tabId, {
        saving: false,
        saveError: t("files.preview.saveError"),
        errorDetail: errorData.error || `HTTP ${res.status}`,
      });
      return false;
    }

    const data = await res.json();
    const current = panel.state.getTab(tabId);
    if (!current) return false;
    panel.state.updateTab(tabId, {
      saving: false,
      dirty: current.content !== savedContent,
      conflict: false,
      mtimeMs: data.mtimeMs,
      originalContent: savedContent,
      saveError: null,
      errorDetail: null,
    });
    return true;
  } catch (error) {
    panel.state.updateTab(tabId, {
      saving: false,
      saveError: t("files.preview.saveError"),
      errorDetail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 * @returns {Promise<boolean>}
 */
async function resolveSaveConflict(panel, tabId) {
  const tab = panel.state.getTab(tabId);
  if (!tab) return false;
  const action = await panel.resolveConflict(tab);
  if (action === "overwrite") {
    panel.state.updateTab(tabId, { conflict: false });
    return performSave(panel, tabId, { force: true });
  }
  if (action === "reload") {
    return panel._reloadTab(tabId, { skipConfirmation: true });
  }
  return false;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string} tabId
 * @param {{ skipConfirmation?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function reloadTab(panel, tabId, { skipConfirmation = false } = {}) {
  panel._captureActiveRenderer();
  const tab = panel.state.getTab(tabId);
  if (!tab) return false;
  if (tab.dirty && !skipConfirmation) {
    const settled = await panel._settleDirtyTabs([tab], "reload");
    if (!settled) return false;
  }
  clearAutoSave(panel, tabId);
  panel.state.updateTab(tabId, {
    conflict: false,
    dirty: false,
    saveError: null,
  });
  const fresh = panel.state.getTab(tabId);
  if (!fresh) return false;
  return panel._loadTabContent(fresh);
}

/**
 * @param {FilePreviewPanel} panel
 * @param {FilePreviewTab[]} tabs
 * @param {string} reason
 * @returns {Promise<boolean>}
 */
export async function settleDirtyTabs(panel, tabs, reason) {
  const action = await panel.confirmDirty(tabs, reason);
  if (action === "cancel" || !action) return false;
  if (action === "save") {
    for (const tab of tabs) {
      const saved = await panel._saveTab(tab.id);
      if (!saved || panel.state.getTab(tab.id)?.dirty) return false;
    }
    return true;
  }
  if (action === "discard") {
    for (const tab of tabs) {
      clearAutoSave(panel, tab.id);
      panel.state.updateTab(tab.id, {
        content: tab.originalContent ?? "",
        dirty: false,
        conflict: false,
        saveError: null,
      });
    }
    return true;
  }
  return false;
}
