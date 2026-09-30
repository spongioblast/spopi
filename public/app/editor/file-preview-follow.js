// ABOUTME: Opens or refreshes the file preview when the agent writes a file.
// ABOUTME: Maps write-tool arguments onto workspace-relative preview paths.

import { normalizeLocalPath } from "../files/path-utils.js";

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "str_replace", "search_replace"]);

/**
 * @param {unknown} toolName
 * @returns {boolean}
 */
export function isWriteTool(toolName) {
  return WRITE_TOOLS.has(String(toolName || "").toLowerCase());
}

/**
 * @param {unknown} args
 * @returns {string}
 */
export function pathFromToolArgs(args) {
  if (!args || typeof args !== "object") return "";
  const record = /** @type {Record<string, unknown>} */ (args);
  for (const key of ["path", "file_path", "filePath"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Turn a tool path into the workspace-relative path FilePreviewPanel.openFile
 * expects. Absolute paths outside the workspace are rejected.
 * @param {unknown} rawPath
 * @param {string} [workspaceRoot]
 * @returns {string}
 */
export function toPreviewPath(rawPath, workspaceRoot = "") {
  const normalized = normalizeLocalPath(rawPath);
  if (!normalized) return "";
  const root = normalizeLocalPath(workspaceRoot);
  if (root) {
    if (normalized === root) return "";
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized) ||
      normalized.startsWith("//")
    ) {
      return "";
    }
    return normalized;
  }
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("//")
  ) {
    return "";
  }
  return normalized;
}

/**
 * @param {unknown} event
 * @param {string} [pendingPath]
 * @returns {boolean}
 */
export function shouldFollowWrite(event, pendingPath = "") {
  const evt =
    /** @type {{ isError?: boolean, args?: unknown, toolName?: string } | null | undefined} */ (
      event
    );
  if (!evt || evt.isError) return false;
  const path = pathFromToolArgs(evt.args) || pendingPath;
  if (!path) return false;
  if (evt.toolName && !isWriteTool(evt.toolName) && !pendingPath) return false;
  return true;
}

/**
 * @param {object} [options]
 * @param {{
 *   workspaceRoot?: string,
 *   revealWrite?: (path: string) => Promise<unknown> | unknown,
 *   openFile?: (path: string, opts?: object) => Promise<unknown> | unknown,
 * } | null | undefined} [options.panel]
 * @param {(() => Promise<string> | string) | undefined} [options.getWorkspacePath]
 * @param {((rawPath: string, previewPath: string) => void) | undefined} [options.onWriteApplied]
 */
export function createFilePreviewFollow({ panel, getWorkspacePath, onWriteApplied } = {}) {
  /** @type {Map<string, string>} */
  const pending = new Map();

  /**
   * @param {unknown} rawPath
   * @returns {Promise<string>}
   */
  async function resolveRelative(rawPath) {
    const root =
      (typeof getWorkspacePath === "function" ? await getWorkspacePath() : "") ||
      panel?.workspaceRoot ||
      "";
    return toPreviewPath(rawPath, root);
  }

  return {
    /**
     * @param {unknown} event
     */
    onToolStart(event) {
      const evt =
        /** @type {{ toolName?: string, args?: unknown, toolCallId?: string } | null | undefined} */ (
          event
        );
      if (!isWriteTool(evt?.toolName)) return;
      const path = pathFromToolArgs(evt?.args);
      if (path && evt?.toolCallId) pending.set(evt.toolCallId, path);
    },

    /**
     * @param {unknown} event
     */
    async onToolEnd(event) {
      const evt = /** @type {{ toolCallId?: string, args?: unknown } | null | undefined} */ (event);
      const remembered = evt?.toolCallId ? pending.get(evt.toolCallId) : "";
      if (evt?.toolCallId) pending.delete(evt.toolCallId);
      if (!shouldFollowWrite(event, remembered)) return null;
      const raw = pathFromToolArgs(evt?.args) || remembered || "";
      const previewPath = await resolveRelative(raw);
      if (!previewPath) return null;
      const tab = panel ? await panel.revealWrite?.(previewPath) : null;
      // Notify after the write is known to be inside the workspace, whether
      // or not a preview panel is attached (turn chips collect from this).
      if (typeof onWriteApplied === "function") onWriteApplied(raw, previewPath);
      return tab;
    },

    /**
     * @param {unknown} rawPath
     * @param {object} [opts]
     */
    async openPath(rawPath, opts = {}) {
      if (!panel) return null;
      const relative = await resolveRelative(rawPath);
      if (!relative) return null;
      return panel.openFile?.(relative, opts);
    },

    clear() {
      pending.clear();
    },
  };
}
