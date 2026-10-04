// ABOUTME: Renders a text or code file in a CodeMirror editor, read-only or editable.
// ABOUTME: CodeMirror is imported on mount, so nothing here loads it at startup.

/**
 * @typedef {import("./file-preview-renderers.js").CodeEditorHandle} CodeEditorHandle
 * @typedef {import("./file-preview-renderers.js").RendererUpdateProps} RendererUpdateProps
 *
 * @typedef {object} TextRendererOptions
 * @property {string} [filePath]
 * @property {string} [content]
 * @property {boolean} [readOnly]
 * @property {boolean} [wrapLines]
 * @property {(value: string) => void} [onChange]
 * @property {() => unknown} [onSave]
 * @property {(error: unknown) => void} [onError]
 */

/**
 * @param {TextRendererOptions} options
 */
export function createTextRenderer({
  filePath,
  content,
  readOnly = true,
  wrapLines = false,
  onChange,
  onSave,
  onError,
}) {
  /** @type {CodeEditorHandle | null} */
  let editor = null;
  let currentReadOnly = readOnly;
  let currentWrap = wrapLines;

  return {
    /** @param {Element} container */
    async mount(container) {
      container.replaceChildren();
      const editorDiv = document.createElement("div");
      editorDiv.className = "file-code-editor";
      container.appendChild(editorDiv);

      const editorOpts = {
        container: editorDiv,
        value: content || "",
        filePath,
        readOnly: currentReadOnly,
        wrapLines: currentWrap,
        onChange,
        onSave,
        onError,
      };
      editor = await (await import("./code-editor.js")).createCodeEditor(editorOpts);
    },

    /** @param {RendererUpdateProps} props */
    update(props) {
      if (props.readOnly !== undefined && props.readOnly !== currentReadOnly) {
        currentReadOnly = props.readOnly;
        if (editor) editor.setReadOnly(currentReadOnly);
      }
      if (props.wrapLines !== undefined && props.wrapLines !== currentWrap) {
        currentWrap = props.wrapLines;
        if (editor) editor.setWrapLines(currentWrap);
      }
    },

    destroy() {
      if (editor) {
        editor.destroy();
        editor = null;
      }
    },

    getValue() {
      if (editor) return editor.getValue();
      return content || "";
    },

    getEditor() {
      return editor;
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
      return "text";
    },
  };
}
