// ABOUTME: Renders the session sidebar and its dismiss overlay.
// ABOUTME: Actions, search, the session list, and the footer stay in this region.

import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";

/** @param {ParentNode} root */
export function mountSidebarChrome(root) {
  const sidebar = el("div", { class: "sidebar", id: "sidebar" }, [
    el("div", { class: "sidebar-header" }, [
      el("div", { class: "sidebar-actions" }, [
        el(
          "button",
          {
            class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
            id: "new-session-btn",
            title: "New session in this project",
            "data-i18n-title": "shell.newSessionTitle",
            "aria-label": "New session in this project",
            "data-i18n-aria-label": "shell.newSessionTitle",
          },
          [createIcon("plus", { size: 14 })],
        ),
        el(
          "button",
          {
            class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
            id: "open-folder-btn",
            title: "Open a folder as a project",
            "data-i18n-title": "sidebar.openFolder",
            "aria-label": "Open folder",
            "data-i18n-aria-label": "sidebar.openFolderAria",
          },
          [createIcon("folder-plus", { size: 14 })],
        ),
        el(
          "button",
          {
            class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn",
            id: "refresh-sessions-btn",
            title: "Refresh sessions",
            "data-i18n-title": "sidebar.refreshSessions",
            "aria-label": "Refresh sessions",
            "data-i18n-aria-label": "sidebar.refreshSessions",
          },
          [createIcon("rotate-cw", { size: 14 })],
        ),
      ]),
    ]),
    el("div", { class: "sidebar-search-wrap" }, [
      el("input", {
        type: "text",
        id: "session-search-input",
        class: "ui-input ui-input--sm sidebar-search-input",
        placeholder: "Search...",
        "data-i18n-ph": "sidebar.search",
        autocomplete: "off",
      }),
      el(
        "button",
        {
          type: "button",
          id: "session-search-clear",
          class: "sidebar-search-clear hidden",
          title: "Clear search",
          "data-i18n-title": "sidebar.clearSearch",
          "aria-label": "Clear search",
          "data-i18n-aria-label": "sidebar.clearSearch",
        },
        [createIcon("x", { size: 12 })],
      ),
    ]),
    el(
      "nav",
      {
        class: "sidebar-primary-nav",
        "aria-label": "Resource management",
        "data-i18n-aria-label": "nav.resourceManagement",
      },
      [
        el(
          "button",
          { type: "button", class: "sidebar-primary-nav-item", id: "sidebar-extensions-btn" },
          [
            createIcon("extensions", { size: 8 }),
            el("span", { "data-i18n": "settings.packages.title" }, ["Packages"]),
          ],
        ),
        el(
          "button",
          { type: "button", class: "sidebar-primary-nav-item", id: "sidebar-skills-btn" },
          [
            createIcon("skills", { size: 15 }),
            el("span", { "data-i18n": "nav.skills" }, ["Skills"]),
          ],
        ),
      ],
    ),
    el("div", { class: "sidebar-section-label", "data-i18n": "sidebar.sessionList" }, ["Sessions"]),
    el("div", { class: "session-list", id: "session-list" }, [
      el(
        "div",
        {
          class: "session-loading ui-loading",
          role: "status",
          "aria-live": "polite",
          "aria-busy": "true",
          "data-i18n": "sidebar.loadingSessions",
        },
        ["Loading sessions..."],
      ),
    ]),
    el("div", { class: "sidebar-footer" }, [
      el("div", { class: "sidebar-settings-row" }, [
        el(
          "button",
          {
            class: "ui-icon-button ui-icon-button--sm sidebar-settings-btn",
            id: "settings-btn",
            title: "Settings",
            "data-i18n-title": "shell.settingsTitle",
            "aria-label": "Settings",
            "data-i18n-aria-label": "shell.settingsTitle",
          },
          [
            createIcon("settings", { size: 14 }),
            el("span", { "data-i18n": "shell.settingsTitle" }, ["Settings"]),
          ],
        ),
        el(
          "button",
          {
            class: "sidebar-update-pill hidden",
            id: "sidebar-update-btn",
            title: "Download and install update",
            "data-i18n-title": "shell.downloadAndInstallUpdateTitle",
            "aria-label": "Download and install update",
            "data-i18n-aria-label": "shell.downloadAndInstallUpdateTitle",
            "data-i18n": "shell.update",
          },
          ["Update"],
        ),
      ]),
    ]),
  ]);
  const overlay = el("div", { class: "sidebar-overlay", id: "sidebar-overlay" });
  const nodes = [sidebar, overlay];
  root.append(sidebar, overlay);
  const refs = {
    sidebar,
    overlay,
    newSessionBtn: sidebar.querySelector("#new-session-btn"),
    openFolderBtn: sidebar.querySelector("#open-folder-btn"),
    refreshSessionsBtn: sidebar.querySelector("#refresh-sessions-btn"),
    sessionList: sidebar.querySelector("#session-list"),
    settingsBtn: sidebar.querySelector("#settings-btn"),
    extensionsBtn: sidebar.querySelector("#sidebar-extensions-btn"),
    skillsBtn: sidebar.querySelector("#sidebar-skills-btn"),
  };
  return {
    refs,
    destroy() {
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * Shell buttons this module creates. Other modules ask here instead of querying ids.
 *
 * @param {ParentNode} [root]
 */
export function sidebarChromeRefs(root = document) {
  return {
    settingsBtn: root.querySelector("#settings-btn"),
    extensionsBtn: root.querySelector("#sidebar-extensions-btn"),
    skillsBtn: root.querySelector("#sidebar-skills-btn"),
    sidebar: root.querySelector("#sidebar"),
    overlay: root.querySelector("#sidebar-overlay"),
    newSessionBtn: root.querySelector("#new-session-btn"),
    openFolderBtn: root.querySelector("#open-folder-btn"),
    refreshSessionsBtn: root.querySelector("#refresh-sessions-btn"),
    sessionList: root.querySelector("#session-list"),
    searchInput: root.querySelector("#session-search-input"),
    searchClear: root.querySelector("#session-search-clear"),
    updateBtn: root.querySelector("#sidebar-update-btn"),
  };
}
