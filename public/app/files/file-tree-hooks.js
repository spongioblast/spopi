// ABOUTME: Connects the file tree to open, reveal, and refresh actions.
// ABOUTME: The tree model itself stays in the file browser.
// ABOUTME: Files-tree refresh hooks: panel show, settled turn, write debounce, workspace switch.

const WATCH_MS = 2000;

/**
 * @typedef {{
 *   loaded?: boolean,
 *   refresh?: () => Promise<unknown>,
 *   setWorkspaceId?: (id: string) => unknown,
 * }} FileTreeHandle
 */

/**
 * @param {{
 *   getTree?: () => FileTreeHandle | null | undefined,
 *   showError?: (error: unknown) => void,
 *   watchMs?: number,
 * }} [options]
 */
export function createFileTreeHooks({ getTree, showError, watchMs = WATCH_MS } = {}) {
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;
  const currentTree = () => (typeof getTree === "function" ? getTree() : undefined);
  /** @param {unknown} error */
  const report = (error) => {
    if (typeof showError === "function") showError(error);
  };

  const scheduleRefresh = () => {
    if (!currentTree()?.loaded) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      currentTree()?.refresh?.()?.catch(report);
    }, 300);
  };

  const watch = setInterval(() => {
    if (globalThis.document?.hidden) return;
    if (globalThis.document?.body?.dataset.railPanel !== "files") return;
    scheduleRefresh();
  }, watchMs);

  return {
    scheduleRefresh,
    /** @param {string} id */
    onPanelShown(id) {
      if (id === "files") currentTree()?.refresh?.()?.catch(report);
    },
    onSettled() {
      if (currentTree()?.loaded) currentTree()?.refresh?.()?.catch(report);
    },
    /** @param {string} id */
    onWorkspaceChange(id) {
      return currentTree()?.setWorkspaceId?.(id);
    },
    stop() {
      clearInterval(watch);
      clearTimeout(timer);
    },
  };
}
