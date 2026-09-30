// ABOUTME: Renders the editor preview column and its resize handle.
// ABOUTME: Tabs, toolbar, and preview content keep their existing ids.

import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";

/** @param {ParentNode} root */
export function mountFilePreviewChrome(root) {
  const nodes = [
    el("hr", {
      class: "file-preview-resizer collapsed",
      id: "file-preview-resizer",
      "aria-orientation": "vertical",
      tabindex: "0",
      "aria-valuenow": "42",
      "aria-valuemin": "20",
      "aria-valuemax": "70",
    }),
    el(
      "section",
      {
        class: "file-preview-panel collapsed",
        id: "file-preview-panel",
        "aria-label": "File preview",
        "data-i18n-aria-label": "files.preview.title",
      },
      [
        el("div", { class: "file-preview-tabs-bar", id: "file-preview-tabs-bar" }, [
          el("div", { class: "file-preview-tabs", id: "file-preview-tabs" }),
          el("div", { class: "file-preview-panel-controls" }, [
            el(
              "button",
              {
                type: "button",
                class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
                id: "file-preview-save-icon",
                title: "Save",
                "data-i18n-title": "files.preview.save",
                "aria-label": "Save",
                "data-i18n-aria-label": "files.preview.save",
                disabled: "",
              },
              [createIcon("save", { size: 14 })],
            ),
            el(
              "button",
              {
                type: "button",
                class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
                id: "file-preview-toolbar-toggle",
                title: "Editor controls",
                "data-i18n-title": "files.preview.showControls",
                "aria-label": "Editor controls",
                "data-i18n-aria-label": "files.preview.showControls",
                "aria-expanded": "false",
                "aria-controls": "file-preview-toolbar",
              },
              [createIcon("editor-controls", { size: 14 })],
            ),
            el(
              "button",
              {
                type: "button",
                class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
                id: "file-preview-run",
                hidden: "",
              },
              [createIcon("play", { size: 14, filled: true })],
            ),
            el(
              "button",
              {
                type: "button",
                class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
                id: "file-preview-open",
                title: "Open in desktop app",
                "data-i18n-title": "files.preview.openDesktop",
                "aria-label": "Open in desktop app",
                "data-i18n-aria-label": "files.preview.openDesktop",
              },
              [createIcon("external-link", { size: 14 })],
            ),
            el(
              "button",
              {
                class:
                  "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-preview-enlarge-btn",
                id: "file-preview-enlarge",
                title: "Enlarge panel",
                "data-i18n-title": "files.preview.enlarge",
                "aria-label": "Enlarge panel",
                "data-i18n-aria-label": "files.preview.enlarge",
              },
              [createIcon("maximize", { size: 14 })],
            ),
            el(
              "button",
              {
                class:
                  "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-preview-collapse-btn hidden",
                id: "file-preview-collapse",
                title: "Collapse panel",
                "data-i18n-title": "files.preview.collapse",
                "aria-label": "Collapse panel",
                "data-i18n-aria-label": "files.preview.collapse",
              },
              [createIcon("minimize", { size: 14 })],
            ),
            el(
              "button",
              {
                class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
                id: "file-preview-close",
                title: "Close panel",
                "data-i18n-title": "files.preview.close",
                "aria-label": "Close panel",
                "data-i18n-aria-label": "files.preview.close",
              },
              [createIcon("x", { size: 14 })],
            ),
          ]),
        ]),
        el(
          "div",
          {
            class: "file-preview-toolbar hidden",
            id: "file-preview-toolbar",
            role: "toolbar",
            "aria-label": "Editor controls",
            "data-i18n-aria-label": "files.preview.showControls",
          },
          [
            el(
              "fieldset",
              {
                class: "file-preview-mode",
                "aria-label": "View mode",
                "data-i18n-aria-label": "files.preview.mode",
              },
              [
                el(
                  "button",
                  {
                    type: "button",
                    id: "file-preview-mode-preview",
                    "data-i18n": "files.preview.preview",
                  },
                  ["Preview"],
                ),
                el(
                  "button",
                  {
                    type: "button",
                    id: "file-preview-mode-edit",
                    "data-i18n": "files.preview.edit",
                  },
                  ["Edit"],
                ),
                el(
                  "button",
                  {
                    type: "button",
                    id: "file-preview-mode-diff",
                    "data-i18n": "files.preview.diff",
                  },
                  ["Diff"],
                ),
              ],
            ),
            el(
              "button",
              {
                type: "button",
                id: "file-preview-save",
                title: "Save",
                "data-i18n-title": "files.preview.save",
                "aria-label": "Save",
                "data-i18n-aria-label": "files.preview.save",
                "data-i18n": "files.preview.save",
              },
              ["Save"],
            ),
            el(
              "button",
              {
                type: "button",
                id: "file-preview-reload",
                title: "Reload from disk",
                "data-i18n-title": "files.preview.conflictReload",
                "aria-label": "Reload from disk",
                "data-i18n-aria-label": "files.preview.conflictReload",
                "data-i18n": "files.preview.conflictReload",
              },
              ["Reload"],
            ),
            el(
              "button",
              {
                type: "button",
                id: "file-preview-search",
                title: "Find",
                "data-i18n-title": "files.preview.find",
                "aria-label": "Find",
                "data-i18n-aria-label": "files.preview.find",
                "data-i18n": "files.preview.find",
              },
              ["Find"],
            ),
            el(
              "button",
              {
                type: "button",
                id: "file-preview-go-to-line",
                title: "Go to line",
                "data-i18n-title": "files.preview.goToLine",
                "aria-label": "Go to line",
                "data-i18n-aria-label": "files.preview.goToLine",
                "data-i18n": "files.preview.goToLine",
              },
              ["Line"],
            ),
            el("input", {
              type: "text",
              class: "file-preview-go-to-line-input hidden",
              id: "file-preview-go-to-line-input",
              inputmode: "numeric",
              autocomplete: "off",
              placeholder: "Line number",
              "data-i18n-ph": "files.preview.goToLinePrompt",
              "aria-label": "Line number",
              "data-i18n-aria-label": "files.preview.goToLinePrompt",
            }),
            el(
              "button",
              {
                type: "button",
                id: "file-preview-copy",
                title: "Copy all",
                "data-i18n-title": "files.preview.copyContent",
                "aria-label": "Copy all",
                "data-i18n-aria-label": "files.preview.copyContent",
                "data-i18n": "files.preview.copyContent",
              },
              ["Copy"],
            ),
            el("label", { class: "file-preview-toolbar-check" }, [
              el("input", { type: "checkbox", id: "file-preview-wrap" }),
              el("span", { "data-i18n": "files.preview.lineWrap" }, ["Wrap"]),
            ]),
            el("label", { class: "file-preview-toolbar-check" }, [
              el("input", { type: "checkbox", id: "file-preview-autosave" }),
              el("span", { "data-i18n": "files.preview.autoSave" }, ["Auto-save"]),
            ]),
            el("span", {
              class: "file-preview-status",
              id: "file-preview-status",
              "aria-live": "polite",
            }),
          ],
        ),
        el("div", { class: "file-preview-content", id: "file-preview-content" }),
      ],
    ),
  ];
  root.append(...nodes);
  const refs = {
    resizer: root.querySelector("#file-preview-resizer"),
    panel: root.querySelector("#file-preview-panel"),
    tabs: root.querySelector("#file-preview-tabs"),
    content: root.querySelector("#file-preview-content"),
    controls: {
      toolbar: root.querySelector("#file-preview-toolbar"),
      toolbarToggle: root.querySelector("#file-preview-toolbar-toggle"),
      preview: root.querySelector("#file-preview-mode-preview"),
      edit: root.querySelector("#file-preview-mode-edit"),
      save: root.querySelector("#file-preview-save"),
      saveIcon: root.querySelector("#file-preview-save-icon"),
      reload: root.querySelector("#file-preview-reload"),
      search: root.querySelector("#file-preview-search"),
      goToLine: root.querySelector("#file-preview-go-to-line"),
      diff: root.querySelector("#file-preview-mode-diff"),
      goToLineInput: root.querySelector("#file-preview-go-to-line-input"),
      copy: root.querySelector("#file-preview-copy"),
      openDesktop: root.querySelector("#file-preview-open"),
      wrap: root.querySelector("#file-preview-wrap"),
      autoSave: root.querySelector("#file-preview-autosave"),
      status: root.querySelector("#file-preview-status"),
      enlarge: root.querySelector("#file-preview-enlarge"),
      collapse: root.querySelector("#file-preview-collapse"),
      close: root.querySelector("#file-preview-close"),
    },
  };
  return {
    refs,
    destroy() {
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * Preview nodes this module creates.
 *
 * @param {ParentNode} [root]
 */
export function filePreviewRefs(root = document) {
  return {
    panel: root.querySelector("#file-preview-panel"),
    tabs: root.querySelector("#file-preview-tabs"),
    resizer: root.querySelector("#file-preview-resizer"),
    run: root.querySelector("#file-preview-run"),
  };
}
