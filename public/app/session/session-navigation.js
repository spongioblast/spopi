// ABOUTME: Handles choosing a session in the sidebar.
// ABOUTME: Selection asks the host to open that session in the current workspace.

import { clearMissingWorkspace, isProjectNotFound, noteMissingPath } from "./missing-workspace.js";

/**
 * @param {object} [options]
 * @param {(sessionId: string) => unknown} [options.switchSession]
 * @param {(session: object) => unknown} [options.openSessionInProject]
 * @param {(error: unknown) => void} [options.onError]
 * @param {(session: object, error: unknown) => void} [options.onMissing]
 */
export function createSessionSelectionHandler({
  switchSession,
  openSessionInProject,
  onError,
  onMissing,
} = {}) {
  /**
   * @param {string | { id?: string, isCurrentWorkspace?: boolean, projectPath?: string } | null | undefined} session
   */
  return function selectSession(session) {
    const sessionId = typeof session === "string" ? session : session?.id;
    if (!sessionId) return;

    const isCurrentWorkspace =
      typeof session === "string" ? true : Boolean(session?.isCurrentWorkspace);
    if (isCurrentWorkspace) {
      Promise.resolve(switchSession?.(sessionId)).catch((error) => onError?.(error));
      return;
    }

    if (session && typeof session === "object") {
      Promise.resolve(openSessionInProject?.(session))
        .then(() => clearMissingWorkspace())
        .catch((error) => {
          if (isProjectNotFound(error)) {
            noteMissingPath(session.projectPath);
            onMissing?.(session, error);
            return;
          }
          onError?.(error);
        });
    }
  };
}
