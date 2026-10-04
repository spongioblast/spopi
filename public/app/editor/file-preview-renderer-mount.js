// ABOUTME: Mounts the active preview tab into the content area: loading placeholder, error text, or a renderer.
// ABOUTME: The renderer is picked by file-preview-renderers.js; its edits and saves are reported back to the panel.

import { t } from "../i18n/i18n.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { isTabEditable } from "./file-preview-mode.js";
import { createFileRenderer } from "./file-preview-renderers.js";
import { sameFileText } from "./file-text.js";

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel
 * @typedef {import("./file-preview-panel.js").FilePreviewTab} FilePreviewTab
 * @typedef {import("./file-preview-panel.js").FilePreviewRenderer} FilePreviewRenderer
 * @typedef {import("./file-preview-renderers.js").FileRendererOptions} FileRendererOptions
 */

/**
 * @param {FilePreviewPanel} panel
 * @param {FilePreviewTab | null | undefined} tab
 */
export async function mountTabRenderer(panel, tab) {
  const content = panel.content;
  if (!tab || tab.id !== panel.state.activeTabId || !content) return;
  panel._destroyRenderer();
  content.replaceChildren();

  if (tab.loading) {
    content.appendChild(
      createLoadingPlaceholder({
        className: "file-preview-loading",
        label: t("files.preview.loading"),
      }),
    );
    panel._renderToolbar();
    return;
  }
  if (tab.error) {
    const errorEl = document.createElement("div");
    errorEl.className = "file-preview-error";
    errorEl.textContent = tab.error;
    content.appendChild(errorEl);
    panel._renderToolbar();
    return;
  }

  const tabId = tab.id;
  const gitDiff = panel.gitDiffCache.get(tab.id);
  /** @type {FileRendererOptions} */
  const rendererOptions = {
    filePath: tab.filePath,
    fileName: tab.fileName,
    content: tab.content || "",
    renderAs: tab.renderAs ?? undefined,
    mode: tab.mode || "preview",
    readOnly: tab.mode !== "edit" || !isTabEditable(tab),
    wrapLines: panel.wrapLines,
    gitDiff:
      gitDiff && typeof gitDiff === "object"
        ? /** @type {{ patch?: string }} */ (gitDiff)
        : undefined,
    onChange: (newContent) => {
      if (panel._interactionLocked) return;
      const freshTab = panel.state.getTab(tabId);
      if (!freshTab) return;
      const dirty = !sameFileText(newContent, freshTab.originalContent ?? "");
      panel.state.updateTab(tabId, {
        content: newContent,
        dirty,
        saveError: null,
      });
      if (dirty) panel._scheduleAutoSave(tabId);
    },
    onSave: () => panel._saveTab(tabId),
    onModeChange: (mode) => {
      if (panel._interactionLocked) return;
      panel.state.updateTab(tabId, { mode });
      panel.state.persist();
    },
    onError: (error) => {
      panel.state.updateTab(tabId, {
        error: t("files.preview.loadError"),
        errorDetail: error instanceof Error ? error.message : String(error),
      });
    },
    rawUrlForPath: /** @type {FileRendererOptions["rawUrlForPath"]} */ (
      panel.fileApi?.rawUrlForPath?.bind(panel.fileApi)
    ),
  };
  panel.currentRenderer = /** @type {FilePreviewRenderer} */ (createFileRenderer(rendererOptions));
  await panel.currentRenderer.mount(content);
  panel._renderToolbar();
}
