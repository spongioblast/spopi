// ABOUTME: Persists the file preview's panel ratio, wrap, and auto-save choice.
// ABOUTME: Storage is optional (opaque WebView origins); every call swallows errors.

import { uiStore } from "../storage/ui-store.js";

export const DEFAULT_PANEL_RATIO = 0.42;

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} [storage]
 */
export function readPreviewPreferences(storage = uiStore) {
  const prefs = { panelRatio: DEFAULT_PANEL_RATIO, wrapLines: false, autoSaveEnabled: false };
  if (!storage) return prefs;
  try {
    const rawRatio = storage.getItem("ui.editor.panelRatio");
    const storedRatio = Number.parseFloat(rawRatio ?? "");
    if (Number.isFinite(storedRatio)) prefs.panelRatio = Math.max(0.2, Math.min(0.7, storedRatio));
    prefs.wrapLines = storage.getItem("ui.editor.wrapLines") === "true";
    prefs.autoSaveEnabled = storage.getItem("ui.editor.autoSaveOptIn") === "true";
  } catch {
    // Fall through with defaults.
  }
  return prefs;
}

/**
 * @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage
 * @param {object} options
 * @param {number} options.panelRatio
 * @param {boolean} options.wrapLines
 * @param {boolean} options.autoSaveEnabled
 */
export function writePreviewPreferences(
  storage = uiStore,
  { panelRatio, wrapLines, autoSaveEnabled },
) {
  if (!storage) return;
  try {
    storage.setItem("ui.editor.panelRatio", String(panelRatio));
    storage.setItem("ui.editor.wrapLines", String(wrapLines));
    storage.setItem("ui.editor.autoSaveOptIn", String(autoSaveEnabled));
  } catch {
    // Storage is optional in opaque WebView origins and private browsing.
  }
}
