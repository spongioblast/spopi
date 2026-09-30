// ABOUTME: Classifies a path as markdown, code, image, pdf, or plain text.
// ABOUTME: No CodeMirror import, so the preview can load this without the editor.

import { basenameLocalPath } from "../files/path-utils.js";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);

const CONVERTIBLE_SUFFIXES_MIRROR = new Set([
  "doc",
  "docx",
  "rtf",
  "odt",
  "ppt",
  "pptx",
  "odp",
  "xls",
  "xlsx",
  "ods",
  "eml",
  "msg",
]);
const NON_PREVIEWABLE_SUFFIXES = new Set(["mbox"]);

/**
 * Classify a file path into a content type.
 * @param {unknown} filePath
 */
export function classifyFilePath(filePath) {
  const ext = getExtension(filePath);

  if (ext === "pdf") {
    return { contentType: "pdf", editable: false, languageId: null };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return { contentType: "image", editable: false, languageId: null };
  }

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return { contentType: "markdown", editable: true, languageId: "markdown" };
  }

  if (ext === "html" || ext === "htm") {
    return { contentType: "html", editable: true, languageId: "html" };
  }

  if (NON_PREVIEWABLE_SUFFIXES.has(ext)) {
    return { contentType: "binary", editable: false, languageId: null };
  }

  if (CONVERTIBLE_SUFFIXES_MIRROR.has(ext)) {
    return { contentType: "convertible", editable: false, languageId: null };
  }

  const languageId = getLanguageId(ext);
  return { contentType: "text", editable: true, languageId };
}

/**
 * @param {string} ext
 * @returns {string | null}
 */
function getLanguageId(ext) {
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
    case "jsonc":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "py":
    case "pyw":
    case "pyi":
      return "python";
    case "css":
    case "scss":
    case "sass":
    case "less":
      return "css";
    case "html":
    case "htm":
    case "xml":
      return "html";
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "env":
      return "shell";
    case "r":
      return "r";
    case "rs":
      return "rust";
    default:
      return null;
  }
}

/**
 * @param {unknown} filePath
 * @returns {string}
 */
export function getExtension(filePath) {
  if (typeof filePath !== "string") return "";
  const basename = basenameLocalPath(filePath) || filePath;
  const idx = basename.lastIndexOf(".");
  if (idx <= 0) return "";
  return basename.slice(idx + 1).toLowerCase();
}
