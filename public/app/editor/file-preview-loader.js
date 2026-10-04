// ABOUTME: Loads a preview tab's file content and turns the host's answer into tab state.
// ABOUTME: Owns load tokens and aborts; mounting the result and the git diff go back through the panel.

import { t } from "../i18n/i18n.js";
import { readFile } from "../transport/workspace-http.js";
import { classifyFilePath } from "./file-classify.js";
import { newlineStyle, normalizeNewlines } from "./file-text.js";

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel
 * @typedef {import("./file-preview-panel.js").FilePreviewTab} FilePreviewTab
 */

/**
 * The message shown when a convertible document needs Python or MarkItDown.
 * @param {{ dependencyReason?: string, pythonVersion?: unknown, displayCommand?: unknown }} data
 */
function dependencyGuidance(data) {
  const reason = data.dependencyReason;
  const version = typeof data.pythonVersion === "string" ? data.pythonVersion : "";
  const messageKey = `files.preview.markitdown.${reason}`;
  const message = t(messageKey, version ? { version } : undefined);
  const needsInstallCommand = reason === "markitdownMissing" || reason === "markitdownIncompatible";
  const displayCommand =
    typeof data.displayCommand === "string" && /^[a-z0-9 ._-]+$/i.test(data.displayCommand)
      ? data.displayCommand
      : /win/i.test(globalThis.navigator?.platform || "")
        ? "py -3"
        : "python3";
  const installKey = /win/i.test(displayCommand)
    ? "files.preview.markitdown.installWindows"
    : "files.preview.markitdown.installPosix";
  const installCommand = t(installKey).replace(/^(python3|py -3)/, displayCommand);
  return needsInstallCommand ? `${message}\n${installCommand}` : message;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {FilePreviewTab} tab
 */
export async function loadPreviewTabContent(panel, tab) {
  panel._abortTabLoad(tab.id);
  const token = (panel.loadTokens.get(tab.id) || 0) + 1;
  panel.loadTokens.set(tab.id, token);
  panel.state.updateTab(tab.id, { loading: true, error: null, errorDetail: null });

  const controller = new AbortController();
  panel.loadAbortControllers.set(tab.id, controller);

  try {
    const res = panel.fileApi?.readFileContent
      ? await panel.fileApi.readFileContent(tab.filePath, { signal: controller.signal })
      : await readFile(tab.filePath, { signal: controller.signal });
    if (panel.loadTokens.get(tab.id) !== token || !panel.state.getTab(tab.id)) return false;
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      panel.state.updateTab(tab.id, {
        loading: false,
        error: t("files.preview.loadError"),
        errorDetail: errorData.error || `HTTP ${res.status}`,
      });
      await panel._mountIfActive(tab.id);
      return false;
    }

    const data = await res.json();
    if (panel.loadTokens.get(tab.id) !== token || !panel.state.getTab(tab.id)) return false;
    const classification = classifyFilePath(tab.filePath);
    if (data.previewStatus === "dependencyUnavailable") {
      panel.state.updateTab(tab.id, {
        loading: false,
        content: null,
        originalContent: null,
        editable: false,
        mode: "preview",
        error: dependencyGuidance(data),
        errorDetail: null,
        isBinary: false,
      });
      await panel._mountIfActive(tab.id);
      return false;
    }
    if (data.previewStatus === "conversionFailed") {
      panel.state.updateTab(tab.id, {
        loading: false,
        content: null,
        originalContent: null,
        editable: false,
        mode: "preview",
        error: t("files.preview.unsupportedBinary"),
        errorDetail: null,
        isBinary: false,
      });
      await panel._mountIfActive(tab.id);
      return false;
    }
    if (
      data.isBinary &&
      (classification.contentType === "text" || classification.contentType === "binary")
    ) {
      panel.state.updateTab(tab.id, {
        loading: false,
        error: t("files.preview.unsupportedBinary"),
        errorDetail: null,
        isBinary: true,
        editable: false,
      });
      await panel._mountIfActive(tab.id);
      return false;
    }

    const editable =
      data.editable !== false && classification.editable && !data.truncated && !data.isBinary;
    /** @type {Partial<FilePreviewTab>} */
    const loadedPatch = {
      loading: false,
      content: normalizeNewlines(data.content ?? ""),
      originalContent: normalizeNewlines(data.content ?? ""),
      newlineStyle: newlineStyle(data.content ?? ""),
      renderAs: data.renderAs,
      mtimeMs: data.mtimeMs,
      mimeType: data.mimeType,
      size: data.size,
      truncated: Boolean(data.truncated),
      isBinary: Boolean(data.isBinary),
      editable,
      dirty: false,
      conflict: false,
      saveError: null,
      error: null,
      errorDetail: null,
      mode: editable ? tab.mode : "preview",
    };
    panel.state.updateTab(
      tab.id,
      /** @type {Partial<import("./file-tab-state.js").FileTab>} */ (
        /** @type {unknown} */ (loadedPatch)
      ),
    );
    panel.state.persist();
    await panel._mountIfActive(tab.id);
    // Fire-and-forget git diff fetch (non-blocking, only when a workspace is known)
    if (panel.workspaceRoot) void panel._fetchGitDiff(tab.id, tab.filePath);
    return true;
  } catch (error) {
    const errName =
      error && typeof error === "object" && "name" in error
        ? String(/** @type {{ name?: unknown }} */ (error).name)
        : "";
    if (errName === "AbortError" || controller.signal.aborted) {
      if (panel.loadTokens.get(tab.id) === token && panel.state.getTab(tab.id)) {
        panel.state.updateTab(tab.id, { loading: false, error: null, errorDetail: null });
      }
      return false;
    }
    if (panel.loadTokens.get(tab.id) !== token || !panel.state.getTab(tab.id)) return false;
    panel.state.updateTab(tab.id, {
      loading: false,
      error: t("files.preview.loadError"),
      errorDetail: error instanceof Error ? error.message : String(error),
    });
    await panel._mountIfActive(tab.id);
    return false;
  } finally {
    if (panel.loadAbortControllers.get(tab.id) === controller) {
      panel.loadAbortControllers.delete(tab.id);
    }
  }
}

/**
 * @param {FilePreviewPanel} panel
 * @param {string | null | undefined} tabId
 */
export function abortPreviewTabLoad(panel, tabId) {
  if (!tabId) return;
  panel.loadTokens.set(tabId, (panel.loadTokens.get(tabId) || 0) + 1);
  const tab = panel.state.getTab(tabId);
  if (tab?.content === null && tab.loading) {
    panel.state.updateTab(tabId, { loading: false, error: null, errorDetail: null });
  }
  const controller = panel.loadAbortControllers.get(tabId);
  if (!controller) return;
  panel.loadAbortControllers.delete(tabId);
  controller.abort();
}
