// ABOUTME: Live HTML preview renderer for the file preview panel.
// ABOUTME: Sandboxed iframe srcdoc in preview mode; CodeMirror source in edit mode.

import { t } from "../i18n/i18n.js";

/** Scripts run in an opaque origin and cannot reach the SPOPI parent. */
export const HTML_IFRAME_SANDBOX = "allow-scripts allow-forms";

/**
 * @typedef {{
 *   getValue: () => string,
 *   destroy: () => void,
 *   openSearch: () => void,
 *   goToLine: (lineNumber: number) => boolean,
 *   setWrapLines: (enabled: boolean) => void,
 * }} HtmlPreviewEditor
 *
 * @typedef {{
 *   filePath?: string,
 *   fileName?: string,
 *   content?: string,
 *   mode?: string,
 *   wrapLines?: boolean,
 *   onChange?: (value: string) => void,
 *   onModeChange?: (mode: string) => void,
 *   onError?: (error: unknown) => void,
 * }} CreateHtmlRendererOptions
 *
 * @typedef {{
 *   mode?: string,
 *   wrapLines?: boolean,
 *   content?: string,
 * }} HtmlRendererUpdateProps
 */

/**
 * @param {CreateHtmlRendererOptions} [options]
 */
export function createHtmlRenderer({
  filePath,
  fileName,
  content,
  mode = "preview",
  wrapLines = false,
  onChange,
  onModeChange,
  onError,
} = {}) {
  /** @type {HtmlPreviewEditor | null} */
  let editor = null;
  /** @type {HTMLIFrameElement | null} */
  let iframe = null;
  /** @type {Element | null} */
  let mountedContainer = null;
  let currentMode = mode === "edit" ? "edit" : "preview";
  let currentContent = content || "";
  let currentWrap = wrapLines;

  return {
    /** @param {Element} container */
    mount(container) {
      mountedContainer = container;
      return renderCurrent(container);
    },

    /** @param {HtmlRendererUpdateProps} props */
    update(props) {
      const modeChanged = props.mode !== undefined && props.mode !== currentMode;
      if (props.mode !== undefined) currentMode = props.mode === "edit" ? "edit" : "preview";
      if (props.wrapLines !== undefined) currentWrap = props.wrapLines;
      if (props.content !== undefined) currentContent = props.content;

      if (modeChanged && mountedContainer) {
        teardownInner();
        renderCurrent(mountedContainer);
        return;
      }
      if (iframe && props.content !== undefined) {
        iframe.srcdoc = currentContent;
      }
      if (props.wrapLines !== undefined) editor?.setWrapLines(currentWrap);
    },

    destroy() {
      teardownInner();
      mountedContainer?.replaceChildren();
      mountedContainer = null;
    },

    getValue() {
      if (editor) return editor.getValue();
      return currentContent;
    },

    getMode() {
      return currentMode;
    },

    /**
     * @param {string} newMode
     * @param {Element | null | undefined} [container]
     */
    setMode(newMode, container) {
      const next = newMode === "edit" ? "edit" : "preview";
      if (currentMode === next) return;
      currentMode = next;
      teardownInner();
      renderCurrent(container || mountedContainer);
      if (typeof onModeChange === "function") onModeChange(next);
    },

    openSearch() {
      editor?.openSearch();
    },

    /** @param {number} lineNumber */
    goToLine(lineNumber) {
      return editor?.goToLine(lineNumber) ?? false;
    },

    /** @param {boolean} enabled */
    setWrapLines(enabled) {
      currentWrap = enabled;
      editor?.setWrapLines(enabled);
    },

    get contentType() {
      return "html";
    },
  };

  function teardownInner() {
    if (editor) {
      currentContent = editor.getValue();
      editor.destroy();
      editor = null;
    }
    iframe = null;
  }

  /** @param {Element | null | undefined} container */
  async function renderCurrent(container) {
    if (!container) return;
    container.replaceChildren();

    if (currentMode === "preview") {
      const wrap = document.createElement("div");
      wrap.className = "file-html-preview";
      iframe = document.createElement("iframe");
      iframe.className = "file-html-frame";
      iframe.setAttribute("sandbox", HTML_IFRAME_SANDBOX);
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.title = t("files.preview.htmlLive");
      iframe.srcdoc = currentContent;
      wrap.appendChild(iframe);
      container.appendChild(wrap);
      return;
    }

    const editorDiv = document.createElement("div");
    editorDiv.className = "file-code-editor";
    container.appendChild(editorDiv);
    editor = await (await import("./code-editor.js")).createCodeEditor({
      container: editorDiv,
      value: currentContent,
      filePath: filePath || fileName || "index.html",
      readOnly: false,
      wrapLines: currentWrap,
      onChange: (val) => {
        currentContent = val;
        if (typeof onChange === "function") onChange(val);
      },
      onError,
    });
  }
}
