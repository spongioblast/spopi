// ABOUTME: Renders the session-info side panel.
// ABOUTME: It stays collapsed until a header toggle opens it.

import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";

/** @param {ParentNode} root */
export function mountSidePanelsChrome(root) {
  const nodes = [
    el("div", { class: "file-sidebar info-sidebar app-side-panel collapsed", id: "info-sidebar" }, [
      el("div", { class: "file-sidebar-header app-side-panel-header" }, [
        el("span", { class: "file-sidebar-title", "data-i18n": "infoPanel.title" }, ["Info"]),
        el(
          "button",
          {
            type: "button",
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn app-side-panel-close-btn",
            id: "info-sidebar-refresh",
            title: "Refresh session history",
            "data-i18n-title": "infoPanel.refresh",
            "aria-label": "Refresh session history",
            "data-i18n-aria-label": "infoPanel.refresh",
          },
          [createIcon("refresh", { size: 14 })],
        ),
        el(
          "button",
          {
            type: "button",
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn app-side-panel-close-btn",
            id: "info-sidebar-close",
            title: "Close",
            "data-i18n-title": "shell.closeTitle",
            "aria-label": "Close session info panel",
            "data-i18n-aria-label": "infoPanel.closeAria",
          },
          [createIcon("x", { size: 14 })],
        ),
      ]),
      el("div", { class: "info-panel", id: "info-panel" }),
    ]),
  ];
  root.append(...nodes);
  const refs = {
    info: root.querySelector("#info-sidebar"),
    infoPanel: root.querySelector("#info-panel"),
    infoRefresh: root.querySelector("#info-sidebar-refresh"),
    infoClose: root.querySelector("#info-sidebar-close"),
  };
  return {
    refs,
    destroy() {
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * The info column this module creates.
 *
 * @param {ParentNode} [root]
 */
export function sidePanelRefs(root = document) {
  return {
    info: root.querySelector("#info-sidebar"),
  };
}
