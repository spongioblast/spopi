// ABOUTME: Renders a markdown file as a preview or as a CodeMirror editor, switching between the two.
// ABOUTME: Markdown to DOM lives in file-preview-markdown.js; CodeMirror is imported only for edit mode.

import { mountCopyButtonDelegation, renderFileMarkdown } from "./file-preview-markdown.js";

/**
 * @typedef {import("./file-preview-renderers.js").CodeEditorHandle} CodeEditorHandle
 * @typedef {import("./file-preview-renderers.js").RendererUpdateProps} RendererUpdateProps
 *
 * @typedef {object} MarkdownRendererOptions
 * @property {string} [filePath]
 * @property {string} [content]
 * @property {string} [mode]
 * @property {boolean} [readOnly]
 * @property {boolean} [wrapLines]
 * @property {(value: string) => void} [onChange]
 * @property {() => unknown} [onSave]
 * @property {(mode: string) => void} [onModeChange]
 * @property {(error: unknown) => void} [onError]
 * @property {boolean} [convertedDocument]
 */

/**
 * @param {MarkdownRendererOptions} options
 */
export function createMarkdownRenderer({
  filePath,
  content,
  mode = "preview",
  wrapLines = false,
  onChange,
  onSave,
  onModeChange,
  onError,
  convertedDocument = false,
}) {
  /** @type {CodeEditorHandle | null} */
  let editor = null;
  /** @type {(() => void) | null} */
  let cleanupCopy = null;
  /** @type {Element | null} */
  let mountedContainer = null;
  let currentMode = mode;
  let currentContent = content || "";
  let currentWrap = wrapLines;

  return {
    /** @param {Element} container */
    mount(container) {
      mountedContainer = container;
      return renderCurrent(container);
    },
    /** @param {RendererUpdateProps} props */
    update(props) {
      const modeChanged = props.mode !== undefined && props.mode !== currentMode;
      if (props.mode !== undefined) currentMode = props.mode;
      if (props.content !== undefined) currentContent = props.content;
      if (props.wrapLines !== undefined) currentWrap = props.wrapLines;

      if (modeChanged && mountedContainer) {
        // Re-render on mode change.
        if (cleanupCopy) {
          cleanupCopy();
          cleanupCopy = null;
        }
        if (editor) {
          currentContent = editor.getValue();
          editor.destroy();
          editor = null;
        }
        renderCurrent(mountedContainer);
        return;
      }
    },

    destroy() {
      if (cleanupCopy) {
        cleanupCopy();
        cleanupCopy = null;
      }
      if (editor) {
        editor.destroy();
        editor = null;
      }
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
     * @param {Element} container
     */
    setMode(newMode, container) {
      if (convertedDocument) return;
      if (currentMode === newMode) return;
      currentMode = newMode;

      // Clean up previous renderer.
      if (cleanupCopy) {
        cleanupCopy();
        cleanupCopy = null;
      }
      if (editor) {
        currentContent = editor.getValue();
        editor.destroy();
        editor = null;
      }

      renderCurrent(container);
      if (typeof onModeChange === "function") {
        onModeChange(newMode);
      }
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
      return "markdown";
    },
  };

  /** @param {Element | null | undefined} container */
  async function renderCurrent(container) {
    if (!container) return;

    if (currentMode === "preview") {
      container.replaceChildren();
      const frag = renderFileMarkdown(currentContent, { convertedDocument });
      const mdDiv = document.createElement("div");
      mdDiv.className = "file-markdown-preview";
      mdDiv.appendChild(frag);
      container.appendChild(mdDiv);
      cleanupCopy = mountCopyButtonDelegation(mdDiv);
    } else {
      // Edit mode: use CodeMirror.
      container.replaceChildren();
      const editorDiv = document.createElement("div");
      editorDiv.className = "file-code-editor";
      container.appendChild(editorDiv);

      const editorOpts = {
        container: editorDiv,
        value: currentContent,
        filePath,
        readOnly: false,
        wrapLines: currentWrap,
        /**
         * @param {string} val
         */
        onChange: (val) => {
          currentContent = val;
          if (typeof onChange === "function") onChange(val);
        },
        onSave,
        onError,
      };
      editor = await (await import("./code-editor.js")).createCodeEditor(editorOpts);
    }
  }
}
