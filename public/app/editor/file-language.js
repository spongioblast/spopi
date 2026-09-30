// ABOUTME: CodeMirror language extension for a file path.
// ABOUTME: Loaded only when the code editor opens a text file.

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { getExtension } from "./file-classify.js";

const shellLanguage = StreamLanguage.define(shell);
const rLanguage = StreamLanguage.define(r);

/**
 * Return the CodeMirror language extension for a file path, or null if
 * no dedicated language mode exists (plain text fallback).
 * @param {unknown} filePath
 */
export function languageExtensionForPath(filePath) {
  const ext = getExtension(filePath);

  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ typescript: false, jsx: ext === "jsx" });
    case "json":
    case "jsonc":
    case "jsonl":
      return json();
    case "yaml":
    case "yml":
      return yaml();
    case "py":
    case "pyw":
    case "pyi":
      return python();
    case "css":
    case "scss":
    case "sass":
    case "less":
      return css();
    case "html":
    case "htm":
    case "xml":
      return html();
    case "md":
    case "markdown":
    case "mdown":
    case "mkd":
      return markdown();
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "env":
      return shellLanguage;
    case "r":
      return rLanguage;
    case "rs":
      return rust();
    default:
      return null;
  }
}
