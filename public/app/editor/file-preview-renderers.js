// ABOUTME: Picks a preview renderer from the file classification.
// ABOUTME: PDF rendering is loaded only when the file is a PDF.

/**
 * File preview renderer factory.
 *
 * Creates the appropriate renderer based on file classification.
 * Each renderer follows the interface: mount(container), update(props), destroy().
 * Text/code renderers expose getValue() for dirty-state extraction.
 */

import { flattenDiffLines } from "../files/patch-utils.js";
import { t } from "../i18n/i18n.js";
import { rawFileUrl } from "../transport/workspace-http.js";
import { classifyFilePath } from "./file-classify.js";
import { createPdfRenderer } from "./file-pdf-preview.js";
import { createHtmlRenderer } from "./file-preview-html.js";
import { mountCopyButtonDelegation, renderFileMarkdown } from "./file-preview-markdown.js";

/**
 * @typedef {{
 *   getValue: () => string,
 *   destroy: () => void,
 *   openSearch: () => void,
 *   goToLine: (lineNumber: number) => boolean,
 *   setWrapLines: (enabled: boolean) => void,
 *   setReadOnly: (readOnly: boolean) => void,
 * }} CodeEditorHandle
 * @typedef {ReturnType<typeof flattenDiffLines>[number]} DiffDisplayLine
 *
 * @typedef {object} FileRendererOptions
 * @property {string} [filePath]
 * @property {string} [fileName]
 * @property {string} [content]
 * @property {string} [mode]
 * @property {boolean} [readOnly]
 * @property {boolean} [wrapLines]
 * @property {(value: string) => void} [onChange]
 * @property {() => unknown} [onSave]
 * @property {(mode: string) => void} [onModeChange]
 * @property {(error: unknown) => void} [onError]
 * @property {(path: string | undefined) => string} [rawUrlForPath]
 * @property {string} [renderAs]
 * @property {{ patch?: string } | null} [gitDiff]
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
 *
 * @typedef {object} TextRendererOptions
 * @property {string} [filePath]
 * @property {string} [content]
 * @property {boolean} [readOnly]
 * @property {boolean} [wrapLines]
 * @property {(value: string) => void} [onChange]
 * @property {() => unknown} [onSave]
 * @property {(error: unknown) => void} [onError]
 *
 * @typedef {object} ImageRendererOptions
 * @property {string} [filePath]
 * @property {string} [fileName]
 * @property {(path: string | undefined) => string} [rawUrlForPath]
 *
 * @typedef {object} DiffRendererOptions
 * @property {string} [patch]
 *
 * @typedef {object} RendererUpdateProps
 * @property {string} [mode]
 * @property {string} [content]
 * @property {boolean} [wrapLines]
 * @property {boolean} [readOnly]
 */

/**
 * @param {FileRendererOptions} [options]
 */
export function createFileRenderer({
  filePath,
  fileName,
  content,
  mode = "preview",
  readOnly = true,
  wrapLines = false,
  onChange,
  onSave,
  onModeChange,
  onError,
  rawUrlForPath,
  renderAs,
  gitDiff,
} = {}) {
  // If a diff is requested and available, return diff renderer
  if (mode === "diff" && gitDiff) {
    return createDiffRenderer({ patch: gitDiff.patch || "" });
  }
  const classification = classifyFilePath(filePath || "");
  if (renderAs === "markdown" && classification.contentType === "convertible") {
    return createMarkdownRenderer({
      filePath,
      content,
      mode: "preview",
      readOnly: true,
      onError,
      convertedDocument: true,
    });
  }

  switch (classification.contentType) {
    case "markdown":
      return createMarkdownRenderer({
        filePath,
        content,
        mode,
        readOnly,
        wrapLines,
        onChange,
        onSave,
        onModeChange,
        onError,
      });

    case "html": {
      const htmlOpts = {
        filePath,
        fileName,
        content,
        mode,
        wrapLines,
        onChange,
        onModeChange,
        onError,
      };
      return createHtmlRenderer(htmlOpts);
    }

    case "convertible":
      return createMarkdownRenderer({
        filePath,
        content,
        mode: "preview",
        readOnly: true,
        onError,
        convertedDocument: true,
      });

    case "image":
      return createImageRenderer({ filePath, fileName, rawUrlForPath });

    case "pdf": {
      const pdfOpts = {
        filePath,
        onError,
        rawUrlForPath,
        getDocumentImpl: undefined,
      };
      return createPdfRenderer(pdfOpts);
    }

    case "text":
      return createTextRenderer({
        filePath,
        content,
        readOnly,
        wrapLines,
        onChange,
        onSave,
        onError,
      });

    default:
      return createTextRenderer({
        filePath,
        content,
        readOnly: true,
        wrapLines,
        onChange,
        onError,
      });
  }
}

// ─── Markdown renderer ──────────────────────────────────────────────────

/**
 * @param {MarkdownRendererOptions} options
 */
function createMarkdownRenderer({
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

// ─── Text/code renderer ─────────────────────────────────────────────────

/**
 * @param {TextRendererOptions} options
 */
function createTextRenderer({
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

// ─── Image renderer ─────────────────────────────────────────────────────

/**
 * @param {ImageRendererOptions} options
 */
function createImageRenderer({ filePath, fileName, rawUrlForPath }) {
  /** @type {HTMLImageElement | null} */
  let imgEl = null;
  /** @type {HTMLDivElement | null} */
  let containerEl = null;

  return {
    /** @param {Element} container */
    mount(container) {
      container.replaceChildren();
      containerEl = document.createElement("div");
      containerEl.className = "file-image-preview";

      imgEl = document.createElement("img");
      imgEl.className = "file-image-img";
      imgEl.alt = fileName || filePath || "";
      imgEl.src =
        typeof rawUrlForPath === "function" ? rawUrlForPath(filePath) : rawFileUrl(filePath);
      imgEl.onerror = () => {
        if (containerEl) {
          containerEl.classList.add("file-image-error");
        }
      };

      containerEl.appendChild(imgEl);
      container.appendChild(containerEl);
    },

    update() {
      // Images have no props to update.
    },

    destroy() {
      if (imgEl) {
        imgEl.src = "";
        imgEl = null;
      }
      if (containerEl?.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
      }
      containerEl = null;
    },

    get contentType() {
      return "image";
    },
  };
}

// ─── Diff renderer ───────────────────────────────────────────────────────────

const CONTEXT_LINES = 3;

/**
 * Render a unified diff patch as an inline colour-coded diff.
 * Exposes the same mount/update/destroy interface as the other renderers.
 *
 * @param {DiffRendererOptions} [options]
 */
function createDiffRenderer({ patch = "" } = {}) {
  /** @type {Element | null} */
  let containerEl = null;

  /** @param {Element} container */
  function renderDiff(container) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "file-diff-view";
    container.appendChild(wrap);

    if (!patch?.trim()) {
      const empty = document.createElement("div");
      empty.className = "file-diff-empty";
      empty.textContent = t("editor.noChanges");
      wrap.appendChild(empty);
      return;
    }

    const lines = flattenDiffLines(patch);
    const hasChanges = lines.some((l) => l.type !== "unchanged");
    if (!hasChanges) {
      const empty = document.createElement("div");
      empty.className = "file-diff-empty";
      empty.textContent = t("editor.noChanges");
      wrap.appendChild(empty);
      return;
    }

    // Determine which line indices are visible (changed ± CONTEXT_LINES)
    const changed = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "unchanged") changed.add(i);
    }
    const visible = new Set();
    for (const ci of changed) {
      for (
        let j = Math.max(0, ci - CONTEXT_LINES);
        j <= Math.min(lines.length - 1, ci + CONTEXT_LINES);
        j++
      ) {
        visible.add(j);
      }
    }

    let i = 0;
    while (i < lines.length) {
      if (visible.has(i)) {
        // Emit a block of visible lines
        while (i < lines.length && visible.has(i)) {
          wrap.appendChild(makeDiffLineEl(lines[i]));
          i++;
        }
      } else {
        // Count collapsed lines
        let count = 0;
        while (i < lines.length && !visible.has(i)) {
          count++;
          i++;
        }
        const collapseEl = document.createElement("div");
        collapseEl.className = "file-diff-collapse";
        collapseEl.textContent = `\u2026 ${count} unchanged line${count !== 1 ? "s" : ""} \u2026`;
        wrap.appendChild(collapseEl);
      }
    }
  }

  /** @param {DiffDisplayLine} line */
  function makeDiffLineEl(line) {
    const row = document.createElement("div");
    let cls = "file-diff-line";
    if (line.type === "added") cls += " file-diff-line--added";
    else if (line.type === "removed") cls += " file-diff-line--removed";
    row.className = cls;

    const gutter = document.createElement("span");
    gutter.className = "file-diff-gutter";
    gutter.textContent =
      line.type === "removed" ? String(line.oldLineNo ?? "") : String(line.newLineNo ?? "");

    const sign = document.createElement("span");
    sign.className = "file-diff-sign";
    sign.setAttribute("aria-hidden", "true");
    sign.textContent = line.type === "added" ? "+" : line.type === "removed" ? "\u2212" : " ";

    const content = document.createElement("span");
    content.className = "file-diff-content";
    content.textContent = line.text || "\u00a0";

    row.appendChild(gutter);
    row.appendChild(sign);
    row.appendChild(content);
    return row;
  }

  return {
    /** @param {Element} container */
    mount(container) {
      containerEl = container;
      renderDiff(container);
    },

    /**
     * @param {DiffRendererOptions} [props]
     */
    update({ patch: newPatch } = {}) {
      if (newPatch !== undefined) patch = newPatch;
      if (containerEl) renderDiff(containerEl);
    },

    destroy() {
      if (containerEl) containerEl.replaceChildren();
      containerEl = null;
    },

    get contentType() {
      return "diff";
    },
  };
}
