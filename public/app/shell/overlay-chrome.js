// ABOUTME: Renders the config editor and session search dialogs.
// ABOUTME: They open on demand; #dialog-container stays the shared modal root.

import { translateSubtree } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";

/**
 * @param {ParentNode | null | undefined} root
 */
export function mountOverlayChrome(root) {
  if (!root || root.querySelector("#session-search-dialog")) return { destroy() {} };
  const host = document.createElement("div");
  host.className = "shell-overlays";
  root.append(host);
  host.replaceChildren(
    el("div", { class: "config-editor-overlay hidden", id: "config-editor-overlay" }),
    el("div", { class: "config-editor-modal hidden", id: "config-editor-modal" }, [
      el("div", { class: "config-editor-header" }, [
        el("div", { class: "config-editor-title-group" }, [
          el("h3", { "data-i18n": "settings.agentConfiguration" }, ["Agent Configuration"]),
          el("span", { class: "config-editor-path", id: "config-editor-path" }),
        ]),
        el("button", { class: "settings-close", id: "config-editor-close" }, [
          el(
            "svg",
            {
              width: "14",
              height: "14",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "2",
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
            },
            [
              el("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
              el("line", { x1: "6", y1: "6", x2: "18", y2: "18" }),
            ],
          ),
        ]),
      ]),
      el("div", { class: "config-editor-body" }, [
        el("textarea", {
          class: "ui-textarea config-editor-textarea",
          id: "config-editor-textarea",
          spellcheck: "false",
          autocomplete: "off",
          autocorrect: "off",
          autocapitalize: "off",
        }),
        el("div", { class: "config-editor-error hidden", id: "config-editor-error" }),
      ]),
      el("div", { class: "config-editor-footer" }, [
        el(
          "button",
          {
            class: "ui-button ui-button--secondary config-editor-cancel",
            id: "config-editor-cancel",
            "data-i18n": "shell.cancel",
          },
          ["Cancel"],
        ),
        el(
          "button",
          {
            class: "ui-button ui-button--primary",
            id: "config-editor-save",
            "data-i18n": "shell.save",
          },
          ["Save"],
        ),
      ]),
    ]),
    el("div", { class: "session-search-overlay hidden", id: "session-search-overlay" }),
    el(
      "div",
      {
        class: "session-search-dialog hidden",
        id: "session-search-dialog",
        role: "dialog",
        "aria-label": "Search tasks",
        "data-i18n-aria-label": "shell.searchTasksLabel",
      },
      [
        el("div", { class: "session-search-input-row" }, [
          el(
            "svg",
            {
              class: "session-search-input-icon",
              width: "18",
              height: "18",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "2",
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "aria-hidden": "true",
            },
            [el("circle", { cx: "11", cy: "11", r: "8" }), el("path", { d: "m21 21-4.3-4.3" })],
          ),
          el("input", {
            type: "text",
            class: "session-search-dialog-input",
            id: "session-search-dialog-input",
            placeholder: "Search tasks and messages…",
            "data-i18n-ph": "shell.searchTasksAndMessagesPlaceholder",
            autocomplete: "off",
            spellcheck: "false",
          }),
        ]),
        el("div", {
          class: "session-search-results",
          id: "session-search-results",
          role: "listbox",
          "aria-label": "Search results",
          "data-i18n-aria-label": "shell.searchResultsLabel",
        }),
      ],
    ),
  );
  translateSubtree(host);
  return {
    destroy() {
      host.remove();
    },
  };
}

/**
 * Session search dialog nodes this module creates.
 *
 * @param {ParentNode} [root]
 */
export function overlayChromeRefs(root = document) {
  return {
    overlay: root.querySelector("#session-search-overlay"),
    dialog: root.querySelector("#session-search-dialog"),
    input: root.querySelector("#session-search-dialog-input"),
    results: root.querySelector("#session-search-results"),
  };
}
