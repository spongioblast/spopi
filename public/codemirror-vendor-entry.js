// ABOUTME: CodeMirror entry bundled into public/vendor/codemirror.js.
// ABOUTME: Re-exports only the names public/app imports; the import map points every specifier here.

export { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
export { css } from "@codemirror/lang-css";
export { html } from "@codemirror/lang-html";
export { javascript } from "@codemirror/lang-javascript";
export { json } from "@codemirror/lang-json";
export { markdown } from "@codemirror/lang-markdown";
export { python } from "@codemirror/lang-python";
export { rust } from "@codemirror/lang-rust";
export { yaml } from "@codemirror/lang-yaml";
export { StreamLanguage, syntaxHighlighting } from "@codemirror/language";
export { r } from "@codemirror/legacy-modes/mode/r";
export { shell } from "@codemirror/legacy-modes/mode/shell";
export { closeSearchPanel, openSearchPanel, search, searchKeymap } from "@codemirror/search";
export { Compartment, EditorState, StateField } from "@codemirror/state";
export { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
export { drawSelection, EditorView, keymap, lineNumbers, showTooltip } from "@codemirror/view";
