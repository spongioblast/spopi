// ABOUTME: Reloads the open preview tab when its file changes on disk, whoever changed it.
// ABOUTME: Polls the file's mtime while the window is visible; a tab with unsaved edits is flagged, not reloaded.

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel
 */

const POLL_MS = 1500;

/**
 * @param {FilePreviewPanel} panel
 * @param {{
 *   statFile: (path: string) => Promise<Response>,
 *   intervalMs?: number,
 *   target?: Window,
 * }} options
 * @returns {{ check: () => Promise<void>, stop: () => void }}
 */
export function watchPreviewDisk(panel, { statFile, intervalMs = POLL_MS, target = window }) {
  let checking = false;
  let activeTabId = panel.state.activeTabId;

  async function check() {
    if (checking || target.document.hidden || !panel.panelOpen) return;
    const tab = panel.state.getActiveTab();
    if (!tab || tab.loading || tab.saving || tab.conflict) return;
    const seen = tab.mtimeMs;
    if (typeof seen !== "number") return;
    checking = true;
    try {
      const res = await statFile(tab.filePath);
      if (!res.ok) return;
      const { mtimeMs } = await res.json();
      const current = panel.state.getTab(tab.id);
      // A save or reload during the request moved mtimeMs; that answer is stale.
      if (!current || current.mtimeMs !== seen) return;
      if (typeof mtimeMs !== "number" || mtimeMs === seen) return;
      if (current.loading || current.saving || panel.savePromises.has(tab.id)) return;
      if (current.dirty) {
        panel.state.updateTab(tab.id, { conflict: true });
        return;
      }
      await panel._reloadTab(tab.id, { skipConfirmation: true, keepView: true });
    } catch {
      // The next tick asks again.
    } finally {
      checking = false;
    }
  }

  const tick = () => void check();
  const timer = setInterval(tick, intervalMs);
  const onVisibility = () => {
    if (!target.document.hidden) tick();
  };
  target.addEventListener("focus", tick);
  target.document.addEventListener("visibilitychange", onVisibility);
  const unsubscribe = panel.state.subscribe(() => {
    if (panel.state.activeTabId === activeTabId) return;
    activeTabId = panel.state.activeTabId;
    tick();
  });

  return {
    check,
    stop() {
      clearInterval(timer);
      target.removeEventListener("focus", tick);
      target.document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe?.();
    },
  };
}
