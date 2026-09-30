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

/** @param {Element | null | undefined} root */
export function mountAppChrome(root) {
  if (!root || root.childElementCount > 0) return { refs: {}, destroy() {} };

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
