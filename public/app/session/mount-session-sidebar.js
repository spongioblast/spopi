// ABOUTME: Mounts SessionSidebar + search dialog onto the session list.
// ABOUTME: Selection goes through createSessionSelectionHandler; no extra owners.

import { sidebarChromeRefs } from "../shell/chrome/sidebar.js";
import { overlayChromeRefs } from "../shell/overlay-chrome.js";
import { createSessionInProjectViaHost } from "./workspace-actions.js";

/**
 * @param {object} options
 * @param {(deps: {
 *   switchSession?: (sessionId: string) => unknown,
 *   openSessionInProject?: (session: object) => unknown,
 *   onError?: (error: unknown) => void,
 *   onMissing?: (session: object, error: unknown) => void,
 * }) => (session: string | object) => void} options.createSessionSelectionHandler
 * @param {(sessionId: string) => unknown} options.switchSession
 * @param {(session: object) => unknown} options.openSessionInProject
 * @param {(error: unknown) => void} options.showError
 * @param {(session: object, error: unknown) => void} [options.onMissing]
 * @param {new (container: Element, opts: object) => { sessions: Array<object> }} options.SessionSidebar
 * @param {(opts: object) => void} options.mountSessionSearchDialog
 * @param {object} options.data
 * @param {object} options.runtime
 * @param {object} options.control
 * @param {object} options.config
 * @param {() => { workspaceId: string, sessionId: string }} options.getTarget
 * @param {(workspaceId: string) => unknown} options.createSessionViaHost
 * @param {(sessions: Array<object>) => void} options.subscribeToLiveSessions
 * @param {(query: string) => void} options.setActiveSearchQuery
 * @param {(opts?: { scrollToFirst?: boolean }) => void} options.applyActiveSearchHighlight
 */
export function mountSessionSidebar({
  createSessionSelectionHandler,
  switchSession,
  openSessionInProject,
  showError,
  onMissing,
  SessionSidebar,
  mountSessionSearchDialog,
  data,
  runtime,
  control,
  config,
  getTarget,
  createSessionViaHost,
  subscribeToLiveSessions,
  setActiveSearchQuery,
  applyActiveSearchHighlight,
}) {
  const container = sidebarChromeRefs().sessionList;
  if (!container) return null;
  const selectSession = createSessionSelectionHandler({
    switchSession,
    openSessionInProject,
    onError: showError,
    onMissing,
  });
  const sidebar = new SessionSidebar(container, {
    data,
    runtime,
    control,
    config,
    getTarget,
    /**
     * @param {object} session
     */
    onSelect: (session) => {
      selectSession(session);
    },
    onCreateSession: createSessionViaHost,
    onCreateSessionInProject: createSessionInProjectViaHost,
    onSessionsLoaded: subscribeToLiveSessions,
    onError: showError,
  });
  const search = sidebarChromeRefs();
  const dialog = overlayChromeRefs();
  mountSessionSearchDialog({
    triggerInput: search.searchInput,
    triggerClear: search.searchClear,
    overlay: dialog.overlay,
    dialog: dialog.dialog,
    input: dialog.input,
    list: dialog.results,
    data,
    getWorkspaceId: () => getTarget().workspaceId,
    getSessions: () => sidebar.sessions,
    /**
     * @param {{ id?: string }} session
     * @param {object} [selectOptions]
     * @param {string} [selectOptions.query]
     */
    onSelect: (session, { query } = {}) => {
      setActiveSearchQuery(query || "");
      selectSession(session);
      if (session?.id === getTarget().sessionId) applyActiveSearchHighlight();
    },
    /**
     * @param {string} query
     */
    onQueryChange: (query) => {
      setActiveSearchQuery(query || "");
      applyActiveSearchHighlight({ scrollToFirst: false });
    },
    onError: showError,
  });
  return sidebar;
}
