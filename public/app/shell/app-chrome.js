// ABOUTME: Composes the workspace shell from six region components.
// ABOUTME: index.html keeps the empty root; this module mounts the regions into it.

import { translateSubtree } from "../i18n/i18n.js";
import { markStartup } from "../perf/startup-marks.js";
import { el } from "../ui/dom.js";
import { mountChatChrome } from "./chrome/chat.js";
import { mountComposerChrome } from "./chrome/composer.js";
import { mountFilePreviewChrome } from "./chrome/file-preview.js";
import { mountFileSidebarChrome } from "./chrome/file-sidebar.js";
import { mountSidePanelsChrome } from "./chrome/side-panels.js";
import { mountSidebarChrome } from "./chrome/sidebar.js";

/**
 * The refs a session window gets once `.app-layout` is empty and the shell mounts.
 * Element fields are typed for call sites that expect HTMLElement / form controls.
 *
 * @typedef {{
 *   layout: { app: HTMLElement, workspace: HTMLElement, content: HTMLElement, main: HTMLElement },
 *   sidebar: {
 *     sidebar: HTMLElement,
 *     overlay: HTMLElement,
 *     newSessionBtn: HTMLElement | null,
 *     openFolderBtn: HTMLElement | null,
 *     refreshSessionsBtn: HTMLElement | null,
 *     sessionList: HTMLElement | null,
 *     settingsBtn: HTMLElement | null,
 *     extensionsBtn: HTMLElement | null,
 *     skillsBtn: HTMLElement | null,
 *   },
 *   chat: {
 *     header: HTMLElement,
 *     headerRight: HTMLElement | null,
 *     status: HTMLElement | null,
 *     messages: HTMLElement | null,
 *     scrollBottomBadge: HTMLElement | null,
 *     sidebarToggle: HTMLElement | null,
 *     sessionInfoToggle: HTMLElement | null,
 *     sessionInfoPanel: HTMLElement | null,
 *     sessionInfoFile: HTMLElement | null,
 *     sessionInfoId: HTMLElement | null,
 *     statusIndicator: HTMLElement | null,
 *     statusText: HTMLElement | null,
 *     sessionCost: HTMLElement | null,
 *     compactContextBtn: HTMLElement | null,
 *     infoSidebarToggle: HTMLElement | null,
 *     diffSidebarToggle: HTMLElement | null,
 *     packageUpdateIndicator: HTMLElement | null,
 *     fileSidebarToggle: HTMLElement | null,
 *   },
 *   composer: {
 *     inputArea: HTMLElement,
 *     form: HTMLFormElement | null,
 *     composerCard: HTMLElement | null,
 *     messageInput: HTMLTextAreaElement | null,
 *     sendBtn: HTMLButtonElement | null,
 *     abortBtn: HTMLButtonElement | null,
 *     thinkingBtn: HTMLButtonElement | null,
 *     queuedMessages: HTMLElement | null,
 *     widgetsAbove: HTMLElement | null,
 *     widgetsBelow: HTMLElement | null,
 *     skillSlashMenu: HTMLElement | null,
 *     atFileMentionMenu: HTMLElement | null,
 *     imagePreviews: HTMLElement | null,
 *     imageInput: HTMLInputElement | null,
 *     attachBtn: HTMLButtonElement | null,
 *     commandBtn: HTMLButtonElement | null,
 *     modelDropdown: HTMLElement | null,
 *     modelDropdownBtn: HTMLButtonElement | null,
 *     modelDropdownLabel: HTMLElement | null,
 *     modelDropdownMenu: HTMLElement | null,
 *   },
 *   filePreview: {
 *     resizer: HTMLElement | null,
 *     panel: HTMLElement | null,
 *     tabs: HTMLElement | null,
 *     content: HTMLElement | null,
 *     controls: import("../editor/file-preview-panel.js").FilePreviewControls,
 *   },
 *   fileSidebar: {
 *     sidebar: HTMLElement,
 *     fileList: HTMLElement | null,
 *     gitPanel: HTMLElement | null,
 *     path: HTMLElement | null,
 *     up: HTMLButtonElement | null,
 *     refresh: HTMLButtonElement | null,
 *     toggleHidden: HTMLButtonElement | null,
 *     collapse: HTMLButtonElement | null,
 *     finder: HTMLButtonElement | null,
 *     close: HTMLButtonElement | null,
 *   },
 *   sidePanels: {
 *     info: HTMLElement | null,
 *     infoPanel: HTMLElement | null,
 *     infoRefresh: HTMLElement | null,
 *     infoClose: HTMLElement | null,
 *   },
 * }} AppChromeRefs
 */

/** @param {Element | null | undefined} root */
export function mountAppChrome(root) {
  if (!(root instanceof HTMLElement) || root.childElementCount > 0) {
    return { refs: {}, destroy() {} };
  }

  const sidebar = mountSidebarChrome(root);
  const workspace = el("div", { class: "workspace" });
  const content = el("div", { class: "workspace-content" });
  const main = el("div", { class: "main" });
  root.append(workspace);

  const chat = mountChatChrome(workspace, main);
  workspace.append(content);
  content.append(main);

  const composer = mountComposerChrome(main);
  const filePreview = mountFilePreviewChrome(content);
  const fileSidebar = mountFileSidebarChrome(content);
  const sidePanels = mountSidePanelsChrome(content);
  translateSubtree(root);
  markStartup("spopi:shell-mounted");

  return {
    refs: {
      layout: { app: root, workspace, content, main },
      sidebar: sidebar.refs,
      chat: chat.refs,
      composer: composer.refs,
      filePreview: filePreview.refs,
      fileSidebar: fileSidebar.refs,
      sidePanels: sidePanels.refs,
    },
    destroy() {
      root.replaceChildren();
    },
  };
}
