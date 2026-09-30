// ABOUTME: Refreshes the git panel after a terminal command finishes.
// ABOUTME: It listens for terminal input that may have changed the worktree.

import { onTerminalInput } from "../terminal/terminal-input-action.js";

/**
 * @param {unknown} dataBase64
 * @param {unknown} data
 * @returns {boolean}
 */
function endsWithNewline(dataBase64, data) {
  if (typeof data === "string" && (data.endsWith("\n") || data.endsWith("\r"))) return true;
  if (!dataBase64) return false;
  try {
    const bytes = atob(/** @type {string} */ (dataBase64));
    const last = bytes.charCodeAt(bytes.length - 1);
    return last === 10 || last === 13;
  } catch {
    return false;
  }
}

/**
 * @typedef {{
 *   type?: string,
 *   toolName?: string,
 *   tool_name?: string,
 * }} GitRefreshFrame
 */

/**
 * @typedef {{
 *   refresh?: (() => void) | null,
 *   isVisible?: (() => boolean) | null,
 *   subscribe?: ((listener: (frame: GitRefreshFrame) => void) => (() => void) | void | undefined) | null,
 *   bashDelayMs?: number,
 *   shellDelayMs?: number,
 *   pollMs?: number,
 * }} GitRefreshHooksOptions
 */

/**
 * @param {GitRefreshHooksOptions} [options]
 * @returns {{
 *   onFrame: (frame: GitRefreshFrame) => void,
 *   setGitVisible: (visible: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function createGitRefreshHooks({
  refresh,
  isVisible,
  subscribe,
  bashDelayMs = 500,
  shellDelayMs = 2000,
  pollMs = 15000,
} = {}) {
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let bashTimer = 0;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let shellTimer = 0;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let pollTimer = 0;

  const run = () => {
    refresh?.();
  };

  /** @param {GitRefreshFrame} frame */
  const onFrame = (frame) => {
    if (frame?.type !== "tool_execution_end") return;
    if (frame.toolName !== "bash" && frame.tool_name !== "bash") return;
    clearTimeout(bashTimer);
    bashTimer = setTimeout(run, bashDelayMs);
  };

  /** @param {{ dataBase64?: string, data?: string, terminalId?: string }} detail */
  const handleTerminalInput = (detail) => {
    if (!endsWithNewline(detail?.dataBase64, detail?.data)) return;
    clearTimeout(shellTimer);
    shellTimer = setTimeout(run, shellDelayMs);
  };

  const unbindInput = onTerminalInput(handleTerminalInput);
  const unsubscribe = subscribe?.(onFrame);

  const stopPoll = () => {
    clearInterval(pollTimer);
    pollTimer = 0;
  };
  const startPoll = () => {
    stopPoll();
    pollTimer = setInterval(() => {
      if (isVisible?.() && document.visibilityState === "visible") run();
    }, pollMs);
  };

  return {
    onFrame,
    /** @param {boolean} visible */
    setGitVisible(visible) {
      if (visible) startPoll();
      else stopPoll();
    },
    destroy() {
      unsubscribe?.();
      unbindInput();
      clearTimeout(bashTimer);
      clearTimeout(shellTimer);
      stopPoll();
    },
  };
}
