// ABOUTME: Drives the file preview controls: panel buttons, mode buttons, save, search, go-to-line, copy, wrap, auto-save.
// ABOUTME: The control elements come from the chrome; actions call back into the panel, which owns the state.

import { t } from "../i18n/i18n.js";
import { classifyFilePath } from "./file-classify.js";
import { isTabEditable } from "./file-preview-mode.js";

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel
 * @typedef {import("./file-preview-panel.js").FilePreviewTab} FilePreviewTab
 */

/** @param {FilePreviewPanel} panel */
export function mountFilePreviewToolbar(panel) {
  const controls = panel.controls;
  panel._listen(controls.enlarge, "click", () => panel.enlarge());
  panel._listen(controls.collapse, "click", () => panel.collapse());
  panel._listen(controls.close, "click", () => {
    void panel.closePanel();
  });
  panel._listen(controls.toolbarToggle, "click", () => {
    panel.toolbarOpen = !panel.toolbarOpen;
    panel._renderToolbar();
  });
  panel._listen(controls.preview, "click", () => void panel._setMode("preview"));
  panel._listen(controls.edit, "click", () => void panel._setMode("edit"));
  panel._listen(controls.diff, "click", () => void panel._setMode("diff"));
  const saveActive = () => {
    const tab = panel.state.getActiveTab();
    if (tab?.dirty) void panel._saveTab(tab.id);
  };
  panel._listen(controls.save, "click", saveActive);
  panel._listen(controls.saveIcon, "click", saveActive);
  panel._listen(
    panel.panel,
    "keydown",
    /** @type {EventListener} */ (
      (event) => {
        const keyEvent = /** @type {KeyboardEvent} */ (event);
        if (!(keyEvent.ctrlKey || keyEvent.metaKey) || keyEvent.key.toLowerCase() !== "s") return;
        keyEvent.preventDefault();
        panel._captureActiveRenderer();
        saveActive();
      }
    ),
  );
  panel._listen(controls.reload, "click", () => {
    const tab = panel.state.getActiveTab();
    if (tab) void panel._reloadTab(tab.id);
  });
  panel._listen(controls.search, "click", () => panel.currentRenderer?.openSearch?.());
  panel._listen(controls.goToLine, "click", () => showGoToLineInput(panel));
  panel._listen(
    controls.goToLineInput,
    "keydown",
    /** @type {EventListener} */ (
      (event) => {
        const keyEvent = /** @type {KeyboardEvent} */ (event);
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          hideGoToLineInput(panel);
          return;
        }
        if (keyEvent.key !== "Enter") return;
        keyEvent.preventDefault();
        const target = keyEvent.target;
        if (!target || !("value" in target)) return;
        const raw = String(/** @type {{ value?: unknown }} */ (target).value ?? "").trim();
        if (/^[1-9]\d*$/.test(raw)) {
          panel.currentRenderer?.goToLine?.(Number(raw));
        }
        hideGoToLineInput(panel);
      }
    ),
  );
  panel._listen(controls.goToLineInput, "blur", () => hideGoToLineInput(panel));
  panel._listen(controls.copy, "click", () => void copyActiveContent(panel));
  panel._listen(controls.openDesktop, "click", () => {
    const tab = panel.state.getActiveTab();
    if (tab) panel.onOpenDesktop(tab.filePath);
  });
  panel._listen(
    controls.wrap,
    "change",
    /** @type {EventListener} */ (
      (event) => {
        const target = event.target;
        panel.wrapLines = Boolean(
          target && "checked" in target && /** @type {{ checked?: unknown }} */ (target).checked,
        );
        panel.currentRenderer?.setWrapLines?.(panel.wrapLines);
        panel._savePreferences();
        panel._renderToolbar();
      }
    ),
  );
  panel._listen(
    controls.autoSave,
    "change",
    /** @type {EventListener} */ (
      (event) => {
        const target = event.target;
        panel.autoSaveEnabled = Boolean(
          target && "checked" in target && /** @type {{ checked?: unknown }} */ (target).checked,
        );
        if (!panel.autoSaveEnabled) {
          for (const tabId of panel.autoSaveTimers.keys()) panel._clearAutoSave(tabId);
        } else {
          const tab = panel.state.getActiveTab();
          if (tab?.dirty) panel._scheduleAutoSave(tab.id);
        }
        panel._savePreferences();
        panel._renderToolbar();
      }
    ),
  );
  panel._renderToolbar();
}

/** @param {FilePreviewPanel} panel */
function showGoToLineInput(panel) {
  if (!panel.controls?.goToLineInput || panel.controls.goToLine?.disabled) return;
  panel.goToLineInputOpen = true;
  panel._renderToolbar();
  panel.controls.goToLineInput.value = "";
  panel.controls.goToLineInput.focus();
}

/** @param {FilePreviewPanel} panel */
function hideGoToLineInput(panel) {
  if (!panel.goToLineInputOpen) return;
  panel.goToLineInputOpen = false;
  panel._renderToolbar();
}

/** @param {FilePreviewPanel} panel */
async function copyActiveContent(panel) {
  panel._captureActiveRenderer();
  const tab = panel.state.getActiveTab();
  if (!tab || typeof tab.content !== "string") return;
  try {
    await panel.onCopyText(tab.content);
    panel.transientStatus = t("messages.copied");
  } catch {
    panel.transientStatus = t("files.preview.copyFailed");
  }
  panel._renderToolbar();
  setTimeout(() => {
    panel.transientStatus = "";
    panel._renderToolbar();
  }, 1200);
}

/** @param {FilePreviewPanel} panel */
export function renderFilePreviewToolbar(panel) {
  const controls = panel.controls;
  if (!controls) return;
  controls.toolbar?.classList.toggle("hidden", !panel.toolbarOpen);
  controls.toolbarToggle?.setAttribute("aria-expanded", String(panel.toolbarOpen));

  const tab = panel.state.getActiveTab();
  const editable = isTabEditable(tab);
  const hasText = typeof tab?.content === "string" && !tab?.isBinary;
  const contentType = tab ? classifyFilePath(tab.filePath).contentType : "";
  const hasEditor =
    hasText &&
    contentType !== "image" &&
    contentType !== "pdf" &&
    contentType !== "convertible" &&
    ((contentType !== "markdown" && contentType !== "html") || tab.mode === "edit");

  const hasDiff = tab
    ? panel.gitDiffCache.has(tab.id) && panel.gitDiffCache.get(tab.id) !== null
    : false;
  if (controls.preview) {
    controls.preview.disabled = !hasText;
    controls.preview.classList.toggle(
      "active",
      hasText && tab?.mode !== "edit" && tab?.mode !== "diff",
    );
    controls.preview.setAttribute(
      "aria-pressed",
      String(hasText && tab?.mode !== "edit" && tab?.mode !== "diff"),
    );
  }
  if (controls.edit) {
    controls.edit.disabled = !editable;
    controls.edit.classList.toggle("active", tab?.mode === "edit");
    controls.edit.setAttribute("aria-pressed", String(tab?.mode === "edit"));
  }
  if (controls.diff) {
    controls.diff.disabled = !hasText;
    controls.diff.title = hasDiff ? t("files.preview.diff") : t("files.preview.noDiff");
    controls.diff.classList.toggle("active", tab?.mode === "diff");
    controls.diff.setAttribute("aria-pressed", String(tab?.mode === "diff"));
  }
  const saveDisabled = !tab?.dirty || !editable || tab.saving;
  if (controls.save) controls.save.disabled = saveDisabled;
  if (controls.saveIcon) controls.saveIcon.disabled = saveDisabled;
  if (controls.reload) controls.reload.disabled = !tab || tab.loading;
  if (controls.search) controls.search.disabled = !hasEditor;
  if (controls.goToLine) {
    controls.goToLine.disabled = !hasEditor;
    controls.goToLine.classList.toggle("hidden", hasEditor && panel.goToLineInputOpen);
  }
  if (controls.goToLineInput) {
    controls.goToLineInput.disabled = !hasEditor;
    controls.goToLineInput.classList.toggle("hidden", !hasEditor || !panel.goToLineInputOpen);
  }
  if (controls.copy) controls.copy.disabled = !hasText;
  if (controls.openDesktop) controls.openDesktop.disabled = !tab;
  if (controls.wrap) controls.wrap.checked = panel.wrapLines;
  if (controls.autoSave) controls.autoSave.checked = panel.autoSaveEnabled;
  if (controls.status) {
    controls.status.textContent = toolbarStatus(panel, tab, editable);
  }
}

/**
 * @param {FilePreviewPanel} panel
 * @param {FilePreviewTab | null | undefined} tab
 * @param {boolean} editable
 */
function toolbarStatus(panel, tab, editable) {
  if (panel.transientStatus) return panel.transientStatus;
  if (!tab) return "";
  if (tab.loading) return t("files.preview.loading");
  if (tab.saving) return t("files.preview.saving");
  if (tab.conflict) return t("files.preview.conflict");
  if (tab.saveError) return tab.saveError;
  if (tab.dirty) return t("files.unsaved.title");
  if (!editable) return t("files.preview.readOnly");
  return t("files.preview.saved");
}
