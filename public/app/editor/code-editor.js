// ABOUTME: CodeMirror editor lifecycle for the file preview pane.
// ABOUTME: Language servers are not attached here. The agent uses pi-lens.

/**
 * CodeMirror editor lifecycle wrapper.
 *
 * Creates and manages a single CodeMirror instance with line numbers,
 * configurable read-only/editable mode, line wrapping, search, and
 * go-to-line support. The EditorView ref is private; callers interact
 * through the returned API object.
 *
 * Source imports @codemirror/* directly — Vitest resolves from node_modules;
 * the browser import map redirects to vendor bundles at runtime.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { drawSelection, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { getLocale, onLocaleChange, t } from "../i18n/i18n.js";
import { appKeybindings } from "../ui/keybindings.js";
import { sendEditorSelectionToChat } from "./editor-context.js";
import { openInlineEditFromEditor } from "./inline-edit.js";
import { selectionActions } from "./selection-actions.js";

/**
 * @typedef {{
 *   container: Element,
 *   value?: string,
 *   filePath?: string,
 *   readOnly?: boolean,
 *   wrapLines?: boolean,
 *   onChange?: (value: string) => void,
 *   onViewReady?: (view: import("@codemirror/view").EditorView) => void,
 *   onViewDestroy?: () => void,
 *   onSelectionToChat?: () => boolean,
 *   onSave?: () => unknown,
 *   onError?: (error: unknown) => void,
 * }} CreateCodeEditorOptions
 */

const SEARCH_PHRASES = {
  zh: {
    Find: "查找",
    Replace: "替换",
    next: "下一个",
    previous: "上一个",
    all: "全部",
    "match case": "区分大小写",
    regexp: "正则表达式",
    "by word": "全词匹配",
    replace: "替换",
    "replace all": "全部替换",
    close: "关闭",
    "current match": "当前匹配项",
    "replaced match on line $": "已替换第 $ 行的匹配项",
    "replaced $ matches": "已替换 $ 个匹配项",
    "Go to line": "跳转到行",
    go: "跳转",
  },
};

/**
 * @param {string} locale
 * @returns {Record<string, string>}
 */
function searchPhrasesForLocale(locale) {
  if (Object.hasOwn(SEARCH_PHRASES, locale)) {
    return SEARCH_PHRASES[/** @type {keyof typeof SEARCH_PHRASES} */ (locale)];
  }
  return {};
}

/**
 * @param {CreateCodeEditorOptions} [options]
 */
export async function createCodeEditor(
  {
    container,
    value = "",
    filePath,
    readOnly = true,
    wrapLines = false,
    onChange,
    onViewReady,
    onViewDestroy,
    onSelectionToChat,
    onSave,
  } = /** @type {CreateCodeEditorOptions} */ ({}),
) {
  if (!container) throw new Error("container is required");

  const editableCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const searchPhrasesCompartment = new Compartment();
  const { languageExtensionForPath } = await import("./file-language.js");
  const languageExt = languageExtensionForPath(filePath || "");
  const editSelection = () => openInlineEditFromEditor({ view }, { path: filePath, onSave });
  const askAboutSelection = () => {
    if (typeof onSelectionToChat === "function") return onSelectionToChat() === true;
    return sendEditorSelectionToChat({ view }, { path: filePath });
  };
  const extensions = [
    lineNumbers(),
    // A drawn selection stays visible while the Ctrl+K prompt has focus.
    drawSelection(),
    selectionActions({ onEdit: editSelection, onAsk: askAboutSelection, t }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    search(),
    keymap.of(searchKeymap),
    editableCompartment.of(EditorView.editable.of(!readOnly)),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    searchPhrasesCompartment.of(EditorState.phrases.of(searchPhrasesForLocale(getLocale()))),
    wrapCompartment.of(wrapLines ? EditorView.lineWrapping : []),
    languageCompartment.of(languageExt ? [languageExt] : []),
    syntaxHighlighting(oneDarkHighlightStyle),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && typeof onChange === "function") {
        onChange(update.state.doc.toString());
      }
    }),
  ];

  const view = new EditorView({
    state: EditorState.create({
      doc: value,
      extensions,
    }),
    parent: container,
  });

  const unsubscribeLocale = onLocaleChange(
    /** @param {string} locale */ (locale) => {
      view.dispatch({
        effects: searchPhrasesCompartment.reconfigure(
          EditorState.phrases.of(searchPhrasesForLocale(locale)),
        ),
      });
    },
  );

  /** @param {KeyboardEvent} event */
  const inEditor = (event) => {
    const target = event?.target;
    return Boolean(
      target &&
        typeof target === "object" &&
        "closest" in target &&
        typeof target.closest === "function" &&
        target.closest(".cm-editor, .cm-content"),
    );
  };
  const unregisterEditorKeys = [
    appKeybindings().register({
      id: "editor.selection",
      keys: "Mod+L",
      labelKey: "keybindings.selection",
      when: inEditor,
      run: askAboutSelection,
    }),
    appKeybindings().register({
      id: "editor.inline",
      keys: "Mod+K",
      labelKey: "keybindings.inlineEdit",
      when: inEditor,
      run: editSelection,
    }),
  ];
  if (typeof onViewReady === "function") {
    onViewReady(view);
  }

  return {
    getValue() {
      return view.state.doc.toString();
    },

    /** @param {string} newValue */
    setValue(newValue) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: newValue,
        },
      });
    },

    focus() {
      view.focus();
    },

    openSearch() {
      openSearchPanel(view);
    },

    closeSearch() {
      closeSearchPanel(view);
    },

    /**
     * Scroll to and select a specific line number (1-indexed).
     * Returns true if the line exists, false otherwise.
     * @param {number} lineNumber
     * @returns {boolean}
     */
    goToLine(lineNumber) {
      if (!Number.isInteger(lineNumber) || lineNumber < 1) return false;
      const lineCount = view.state.doc.lines;
      if (lineNumber > lineCount) return false;
      const line = view.state.doc.line(lineNumber);
      view.dispatch({
        selection: { anchor: line.from, head: line.to },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    },

    /** @param {boolean} newReadOnly */
    setReadOnly(newReadOnly) {
      view.dispatch({
        effects: [
          editableCompartment.reconfigure(EditorView.editable.of(!newReadOnly)),
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(newReadOnly)),
        ],
      });
    },

    /** @param {boolean} enabled */
    setWrapLines(enabled) {
      view.dispatch({
        effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },

    destroy() {
      for (const unregister of unregisterEditorKeys) unregister();
      unsubscribeLocale();
      if (typeof onViewDestroy === "function") {
        onViewDestroy();
      }
      view.destroy();
    },

    get view() {
      return view;
    },
  };
}
