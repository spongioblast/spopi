// ABOUTME: Picks a preview renderer from the file classification and the tab's mode.
// ABOUTME: Each renderer lives in its own module; this file only dispatches and defines the shared types.

/**
 * File preview renderer factory.
 *
 * Creates the appropriate renderer based on file classification.
 * Each renderer follows the interface: mount(container), update(props), destroy().
 * Text/code renderers expose getValue() for dirty-state extraction.
 */

import { classifyFilePath } from "./file-classify.js";
import { createPdfRenderer } from "./file-pdf-preview.js";
import { createDiffRenderer } from "./file-preview-diff-renderer.js";
import { createHtmlRenderer } from "./file-preview-html.js";
import { createImageRenderer } from "./file-preview-image-renderer.js";
import { createMarkdownRenderer } from "./file-preview-markdown-renderer.js";
import { createTextRenderer } from "./file-preview-text-renderer.js";

/**
 * @typedef {{
 *   getValue: () => string,
 *   destroy: () => void,
 *   openSearch: () => void,
 *   goToLine: (lineNumber: number) => boolean,
 *   setWrapLines: (enabled: boolean) => void,
 *   setReadOnly: (readOnly: boolean) => void,
 * }} CodeEditorHandle
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
