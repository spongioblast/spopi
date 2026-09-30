// ABOUTME: Renders the session header and the message column.
// ABOUTME: The composer and the editor panels mount beside this region.

import { t } from "../../i18n/i18n.js";
import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";

/**
 * @param {ParentNode} workspace
 * @param {ParentNode} main
 */
export function mountChatChrome(workspace, main) {
  const header = el("div", { class: "header session-header" }, [
    el("div", { class: "header-left" }, [
      el(
        "button",
        {
          class: "sidebar-toggle",
          id: "sidebar-toggle",
          title: "Toggle sidebar",
          "data-i18n-title": "nav.toggleSidebar",
          "aria-label": "Toggle sidebar",
          "data-i18n-aria-label": "nav.toggleSidebar",
        },
        [createIcon("menu", { size: 18 })],
      ),
      el("span", { class: "session-info-anchor" }, [
        el(
          "button",
          {
            type: "button",
            class:
              "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn session-info-toggle session-info-toggle--dim hidden",
            id: "session-info-toggle",
            title: "Session info",
            "data-i18n-title": "sessionInfo.title",
            "aria-label": "Session info",
            "data-i18n-aria-label": "sessionInfo.title",
            "aria-expanded": "false",
            "aria-controls": "session-info-panel",
          },
          [createIcon("circle-info", { size: 16 })],
        ),
        el(
          "section",
          {
            class: "session-info-panel hidden",
            id: "session-info-panel",
            "aria-labelledby": "session-info-heading",
          },
          [
            el("h2", { id: "session-info-heading", "data-i18n": "sessionInfo.heading" }, [
              "Session Info",
            ]),
            el("dl", { class: "session-info-list" }, [
              el("div", { class: "session-info-row" }, [
                el("dt", { "data-i18n": "sessionInfo.file" }, ["File"]),
                el("dd", {}, [
                  el("span", { class: "session-info-value", id: "session-info-file" }),
                  el(
                    "button",
                    {
                      type: "button",
                      class:
                        "ui-icon-button ui-icon-button--xs ui-icon-button--ghost session-info-copy",
                      "data-copy-session-field": "file",
                      title: "Copy file path",
                      "data-i18n-title": "sessionInfo.copyFile",
                      "aria-label": "Copy file path",
                      "data-i18n-aria-label": "sessionInfo.copyFile",
                    },
                    [createIcon("copy", { size: 14 })],
                  ),
                ]),
              ]),
              el("div", { class: "session-info-row" }, [
                el("dt", { "data-i18n": "sessionInfo.id" }, ["ID"]),
                el("dd", {}, [
                  el("span", { class: "session-info-value", id: "session-info-id" }),
                  el(
                    "button",
                    {
                      type: "button",
                      class:
                        "ui-icon-button ui-icon-button--xs ui-icon-button--ghost session-info-copy",
                      "data-copy-session-field": "id",
                      title: "Copy session ID",
                      "data-i18n-title": "sessionInfo.copyId",
                      "aria-label": "Copy session ID",
                      "data-i18n-aria-label": "sessionInfo.copyId",
                    },
                    [createIcon("copy", { size: 14 })],
                  ),
                ]),
              ]),
            ]),
          ],
        ),
      ]),
      el("div", { class: "status" }, [
        el("span", { class: "status-indicator", id: "status-indicator" }),
        el("span", { class: "status-text", id: "status-text" }, ["Connecting..."]),
      ]),
    ]),
    el("div", { class: "header-right" }, [
      el("span", {
        class: "pill session-cost",
        id: "session-cost",
        title: "Session cost",
        "data-i18n-title": "usage.sessionCostTitle",
      }),
      el("span", { class: "context-usage-anchor" }, [
        el("span", {
          class: "pill token-usage",
          id: "token-usage",
          title: "Context usage",
          "data-i18n-title": "usage.contextTitle",
        }),
        el("div", { class: "context-viz hidden", id: "context-viz" }, [
          el("div", { class: "context-viz-title", "data-i18n": "misc.contextWindow" }, [
            "Context Window",
          ]),
          el("div", { class: "context-bar", id: "context-bar" }),
          el("div", { class: "context-legend", id: "context-legend" }),
          el("div", { class: "context-viz-footer" }, [
            el("span", { class: "context-viz-summary" }, [
              el("span", { id: "context-viz-used" }),
              el("span", { id: "context-viz-total" }),
            ]),
            el(
              "button",
              {
                type: "button",
                class: "ui-button ui-button--sm ui-button--secondary context-viz-compact-btn",
                id: "compact-context-btn",
                title: "Compact context to save tokens",
                "data-i18n-title": "input.compactDesc",
                "aria-label": "Compact context to save tokens",
                "data-i18n-aria-label": "input.compactDesc",
              },
              [
                el("span", { class: "compact-btn-label", "data-i18n": "input.compact" }, [
                  "Compact",
                ]),
              ],
            ),
          ]),
        ]),
      ]),
      el("span", { class: "header-open-app hidden", id: "header-open-app" }, [
        el(
          "button",
          {
            class: "ui-button ui-button--sm ui-button--secondary header-open-app-btn",
            id: "header-open-app-btn",
            title: "Open project",
            "data-i18n-title": "nav.openWorkspace",
            "aria-label": "Open project in app",
            "data-i18n-aria-label": "nav.openWorkspaceInApp",
          },
          [
            el(
              "span",
              {
                class: "header-open-app-logo",
                id: "header-open-app-logo",
                "aria-hidden": "true",
              },
              [
                el("img", {
                  src: "icons/app-cursor.svg",
                  alt: "",
                  class: "header-open-app-logo-img",
                }),
              ],
            ),
          ],
        ),
        el(
          "button",
          {
            class: "header-open-app-toggle",
            id: "header-open-app-toggle",
            title: "Choose app",
            "data-i18n-title": "shell.chooseAppTitle",
            "aria-label": "Choose app to open workspace",
            "data-i18n-aria-label": "nav.chooseApp",
          },
          [createIcon("chevron-down", { size: 10 })],
        ),
        el("div", { class: "header-open-app-menu hidden", id: "header-open-app-menu" }),
      ]),
      el(
        "button",
        {
          type: "button",
          class:
            "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn file-sidebar-toggle",
          id: "file-sidebar-toggle",
          title: "Files",
          "data-i18n-title": "shell.filesTitle",
          "aria-label": "Toggle file browser",
          "data-i18n-aria-label": "shell.toggleFileBrowserLabel",
        },
        [
          createIcon("folder", { size: 16 }),
          el("span", {
            class: "file-sidebar-toggle__label hidden",
            id: "workspace-indicator",
            "aria-hidden": "true",
          }),
        ],
      ),
      el(
        "button",
        {
          class:
            "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn git-branch-toggle hidden",
          id: "diff-sidebar-toggle",
          title: "Toggle Git changes",
          "data-i18n-title": "git.toggleChanges",
          "aria-label": "Toggle Git changes",
          "data-i18n-aria-label": "git.toggleChanges",
        },
        [
          createIcon("git-info", { size: 16 }),
          el("span", { class: "git-branch-toggle__label", id: "git-branch-indicator" }),
        ],
      ),
      el(
        "button",
        {
          type: "button",
          class:
            "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn info-sidebar-toggle",
          id: "info-sidebar-toggle",
          title: "Session info",
          "data-i18n-title": "infoPanel.title",
          "aria-label": "Toggle session info panel",
          "data-i18n-aria-label": "infoPanel.toggleAria",
        },
        [createIcon("circle-info", { size: 16 })],
      ),
      el(
        "button",
        {
          type: "button",
          class:
            "ui-icon-button ui-icon-button--sm ui-icon-button--ghost icon-btn update-indicator hidden",
          id: "package-update-indicator",
          title: "Extension updates available",
          "data-i18n-title": "header.extensionUpdatesAvailable",
          "aria-label": t("header.extensionUpdatesAvailable"),
          "data-i18n-aria-label": "header.extensionUpdatesAvailable",
        },
        [
          createIcon("refresh", { size: 16 }),
          el("span", { class: "update-indicator-count", "aria-hidden": "true" }),
        ],
      ),
    ]),
  ]);
  const column = [
    el("div", { class: "messages", id: "messages", tabindex: "0" }, [
      el("div", { class: "welcome" }, [
        el("div", { class: "welcome-icon" }, [
          el("img", {
            src: "icons/logo-dark.svg",
            alt: "SPOPI logo",
            "data-i18n-alt": "shell.spopiLogoAlt",
            class: "welcome-logo",
          }),
        ]),
        el("p", { "data-i18n": "app.welcome" }, ["Welcome to SPOPI"]),
        el("p", { class: "hint", "data-i18n": "app.welcomeHint" }, [
          "Type a message below to start chatting with Pi, or select a session from the sidebar.",
        ]),
        el("div", { class: "shortcuts-hint" }, [
          el("span", {}, [
            el("kbd", {}, ["/"]),
            el("span", { "data-i18n": "shortcuts.focusInput" }, ["Focus input"]),
          ]),
          el("span", {}, [
            el("kbd", {}, ["Esc"]),
            el("span", { "data-i18n": "shortcuts.abort" }, ["Abort"]),
          ]),
        ]),
      ]),
    ]),
    el(
      "nav",
      {
        class: "conv-nav hidden",
        id: "conv-nav",
        "aria-label": "Conversation navigator",
        "data-i18n-aria-label": "shell.conversationNavigatorLabel",
      },
      [el("div", { class: "conv-nav-track", id: "conv-nav-track" })],
    ),
    el("div", { class: "conv-nav-tooltip hidden", id: "conv-nav-tooltip", "aria-hidden": "true" }, [
      el("div", { class: "conv-nav-tooltip-q", id: "conv-nav-tooltip-q" }),
      el("div", { class: "conv-nav-tooltip-sep", id: "conv-nav-tooltip-sep" }),
      el("div", { class: "conv-nav-tooltip-a", id: "conv-nav-tooltip-a" }),
    ]),
    el(
      "div",
      {
        class: "conv-nav-new-badge hidden",
        id: "scroll-bottom-badge",
        "data-i18n": "shell.new",
      },
      ["New ↓"],
    ),
  ];
  const nodes = [header, ...column];
  workspace.append(header);
  main.append(...column);
  const refs = {
    header,
    messages: main.querySelector("#messages"),
    scrollBottomBadge: main.querySelector("#scroll-bottom-badge"),
    sidebarToggle: header.querySelector("#sidebar-toggle"),
    sessionInfoToggle: header.querySelector("#session-info-toggle"),
    sessionInfoPanel: header.querySelector("#session-info-panel"),
    sessionInfoFile: header.querySelector("#session-info-file"),
    sessionInfoId: header.querySelector("#session-info-id"),
    statusIndicator: header.querySelector("#status-indicator"),
    statusText: header.querySelector("#status-text"),
    sessionCost: header.querySelector("#session-cost"),
    compactContextBtn: header.querySelector("#compact-context-btn"),
    infoSidebarToggle: header.querySelector("#info-sidebar-toggle"),
    diffSidebarToggle: header.querySelector("#diff-sidebar-toggle"),
    packageUpdateIndicator: header.querySelector("#package-update-indicator"),
    fileSidebarToggle: header.querySelector("#file-sidebar-toggle"),
  };
  return {
    refs,
    destroy() {
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * Header controls this module creates. Other modules ask here instead of querying ids.
 *
 * @param {ParentNode} [root]
 */
export function headerChromeRefs(root = document) {
  return {
    packageUpdateIndicator: root.querySelector("#package-update-indicator"),
    sidebarToggle: root.querySelector("#sidebar-toggle"),
    messages: root.querySelector("#messages"),
    diffSidebarToggle: root.querySelector("#diff-sidebar-toggle"),
    tokenUsage: root.querySelector("#token-usage"),
    contextViz: root.querySelector("#context-viz"),
    contextBar: root.querySelector("#context-bar"),
    contextLegend: root.querySelector("#context-legend"),
    contextVizUsed: root.querySelector("#context-viz-used"),
    contextVizTotal: root.querySelector("#context-viz-total"),
    compactContextBtn: root.querySelector("#compact-context-btn"),
    convNav: root.querySelector("#conv-nav"),
    convNavTrack: root.querySelector("#conv-nav-track"),
    convNavTooltip: root.querySelector("#conv-nav-tooltip"),
    convNavTooltipQ: root.querySelector("#conv-nav-tooltip-q"),
    convNavTooltipA: root.querySelector("#conv-nav-tooltip-a"),
    convNavTooltipSep: root.querySelector("#conv-nav-tooltip-sep"),
    openApp: root.querySelector("#header-open-app"),
    openAppBtn: root.querySelector("#header-open-app-btn"),
    openAppLogo: root.querySelector("#header-open-app-logo"),
    openAppToggle: root.querySelector("#header-open-app-toggle"),
    openAppMenu: root.querySelector("#header-open-app-menu"),
    workspaceIndicator: root.querySelector("#workspace-indicator"),
    gitBranch: root.querySelector("#git-branch-indicator"),
    fileSidebarToggle: root.querySelector("#file-sidebar-toggle"),
  };
}
