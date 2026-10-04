// ABOUTME: Renders the file browser with its search box, and the git panel it hosts.
// ABOUTME: Search hits replace the tree while a query is typed, like the Sessions search.

import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";

/** @param {ParentNode} root */
export function mountFileSidebarChrome(root) {
  const sidebar = el(
    "div",
    { class: "file-sidebar app-side-panel collapsed", id: "file-sidebar" },
    [
      el("div", { class: "file-sidebar-header app-side-panel-header" }, [
        el(
          "button",
          {
            class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
            id: "file-sidebar-up",
            title: "Parent directory",
            "data-i18n-title": "files.parentDirectory",
          },
          [createIcon("arrow-up", { size: 14 })],
        ),
        el(
          "button",
          {
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-sidebar-action",
            id: "file-sidebar-refresh",
            title: "Refresh directory",
            "aria-label": "Refresh current directory listing",
            "data-i18n-title": "files.refreshDirectory",
            "data-i18n-aria-label": "files.refreshDirectoryAria",
          },
          [createIcon("refresh", { size: 14 })],
        ),
        el(
          "button",
          {
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-sidebar-action",
            id: "file-sidebar-toggle-hidden",
            title: "Show hidden files",
            "aria-label": "Show hidden files",
            "aria-pressed": "false",
            "data-i18n-title": "files.showHiddenFiles",
            "data-i18n-aria-label": "files.showHiddenFilesAria",
          },
          [createIcon("eye-off", { size: 14 })],
        ),
        el(
          "button",
          {
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-sidebar-action hidden",
            id: "git-panel-refresh",
            title: "Refresh Git status",
            "aria-label": "Refresh Git status",
            "data-i18n-title": "git.refresh",
            "data-i18n-aria-label": "git.refresh",
          },
          [createIcon("refresh", { size: 14 })],
        ),
        el(
          "button",
          {
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-sidebar-action",
            id: "file-sidebar-collapse",
            title: "Collapse all",
            "aria-label": "Collapse all folders",
            "data-i18n-title": "files.collapseAll",
            "data-i18n-aria-label": "files.collapseAll",
          },
          [createIcon("collapse-all", { size: 14 })],
        ),
        el(
          "button",
          {
            class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
            id: "file-sidebar-finder",
            title: "Open in file manager",
            "data-i18n-title": "files.openInFileManager",
          },
          [createIcon("folder-open", { size: 14 })],
        ),
        el(
          "button",
          {
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn app-side-panel-close-btn",
            id: "file-sidebar-close",
            title: "Close",
            "data-i18n-title": "shell.closeTitle",
            "aria-label": "Close file browser",
            "data-i18n-aria-label": "files.close",
          },
          [createIcon("x", { size: 14 })],
        ),
      ]),
      el("div", { class: "sidebar-search-wrap file-search-wrap" }, [
        el("input", {
          type: "search",
          id: "file-search-input",
          class: "ui-input ui-input--sm sidebar-search-input",
          placeholder: "Search files",
          "data-i18n-ph": "search.placeholder",
          autocomplete: "off",
          spellcheck: "false",
        }),
        el(
          "button",
          {
            type: "button",
            id: "file-search-clear",
            class: "sidebar-search-clear hidden",
            title: "Clear search",
            "data-i18n-title": "sidebar.clearSearch",
            "aria-label": "Clear search",
            "data-i18n-aria-label": "sidebar.clearSearch",
          },
          [createIcon("x", { size: 12 })],
        ),
      ]),
      el("div", { class: "file-sidebar-path", id: "file-sidebar-path", title: "" }),
      el("div", { class: "file-list", id: "file-list" }),
      el("div", {
        class: "file-search-results search-hit-list hidden",
        id: "file-search-results",
      }),
      el("div", { class: "git-panel hidden", id: "git-panel" }),
    ],
  );
  const nodes = [sidebar];
  root.append(sidebar);
  const refs = {
    sidebar,
    fileList: sidebar.querySelector("#file-list"),
    gitPanel: sidebar.querySelector("#git-panel"),
    path: sidebar.querySelector("#file-sidebar-path"),
    up: sidebar.querySelector("#file-sidebar-up"),
    refresh: sidebar.querySelector("#file-sidebar-refresh"),
    toggleHidden: sidebar.querySelector("#file-sidebar-toggle-hidden"),
    collapse: sidebar.querySelector("#file-sidebar-collapse"),
    finder: sidebar.querySelector("#file-sidebar-finder"),
    close: sidebar.querySelector("#file-sidebar-close"),
  };
  return {
    refs,
    destroy() {
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * File browser nodes this module creates.
 *
 * @param {ParentNode} [root]
 */
export function fileSidebarRefs(root = document) {
  return {
    sidebar: root.querySelector("#file-sidebar"),
    fileList: root.querySelector("#file-list"),
    path: root.querySelector("#file-sidebar-path"),
    gitPanel: root.querySelector("#git-panel"),
    close: root.querySelector("#file-sidebar-close"),
    up: root.querySelector("#file-sidebar-up"),
    refresh: root.querySelector("#file-sidebar-refresh"),
    toggleHidden: root.querySelector("#file-sidebar-toggle-hidden"),
    finder: root.querySelector("#file-sidebar-finder"),
    collapse: root.querySelector("#file-sidebar-collapse"),
    gitRefresh: root.querySelector("#git-panel-refresh"),
    searchInput: root.querySelector("#file-search-input"),
    searchClear: root.querySelector("#file-search-clear"),
    searchResults: root.querySelector("#file-search-results"),
  };
}
