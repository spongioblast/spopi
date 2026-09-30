// ABOUTME: Chat file.preview and terminal.run subscriptions, plus Run-file late binding.
// ABOUTME: Run-in-terminal writes the command into the dock PTY.

import { runFileInTerminal, writeCommandToPty } from "../terminal/run-file.js";
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
 *   workbench?: unknown,
 *   lateBindings?: { runFile?: (path: string) => unknown },
 *   showError?: (err: unknown) => void,
 * }} [options]
 */
export function mountChatFileActions({
  runtime,
  filePreviewFollow,
  terminalIntegration,
  workbench,
  lateBindings,
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

  if (lateBindings) {
    /** @param {string} path */
    lateBindings.runFile = (path) => {
      const options = {
        client: terminalIntegration?.client,
        panel: terminalIntegration?.panel,
        workbench,
        path,
      };
      return runFileInTerminal(/** @type {{ getDefaultProfile?: () => unknown }} */ (options));
    };
  }

  return {
    destroy() {
      unbind();
      unsubscribe();
    },
  };
}
