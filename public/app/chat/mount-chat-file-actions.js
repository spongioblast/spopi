// ABOUTME: Chat file.preview and terminal.run subscriptions.
// ABOUTME: Run-in-terminal writes the command into the dock PTY.

import { writeCommandToPty } from "../terminal/run-file.js";
import { setFileActionDispatch } from "./file-actions.js";

/**
 * @param {{
 *   runtime?: {
 *     dispatch?: (action: { type: string, path?: string, line?: number, command?: string }) => void,
 *     subscribe?: (
 *       fn: (
 *         state: unknown,
 *         action: { type?: string, path?: string, line?: number, command?: string },
 *       ) => void,
 *     ) => (() => void) | void,
 *   },
 *   filePreviewFollow?: { openPath: (path: string, opts?: { line?: number }) => Promise<unknown> },
 *   terminalIntegration?: {
 *     client?: unknown,
 *     panel?: { tabs?: Array<{ status?: string, terminalId?: string }>, activeTerminalId?: string },
 *   },
 *   showError?: (err: unknown) => void,
 * }} [options]
 */
export function mountChatFileActions({
  runtime,
  filePreviewFollow,
  terminalIntegration,
  showError,
} = {}) {
  /** @param {{ type: string, path?: string, line?: number, command?: string }} action */
  const dispatch = (action) => runtime?.dispatch?.(action);
  const unbind = setFileActionDispatch(dispatch);
  const unsubscribe =
    runtime?.subscribe?.((_state, action) => {
      if (action?.type === "file.preview" && action.path) {
        const follow =
          /** @type {{ openPath: (path: string, opts?: { line?: number }) => Promise<unknown> }} */ (
            filePreviewFollow
          );
        void follow.openPath(action.path, { line: action.line }).catch(showError);
      } else if (action?.type === "terminal.run" && action.command && terminalIntegration?.client) {
        const running = (terminalIntegration.panel?.tabs || []).find(
          (tab) => tab.status === "running",
        );
        writeCommandToPty(
          terminalIntegration.client,
          action.command,
          /** @type {null | undefined} */ (/** @type {unknown} */ (running?.terminalId)),
        );
      }
    }) ?? (() => {});

  return {
    destroy() {
      unbind();
      unsubscribe();
    },
  };
}
