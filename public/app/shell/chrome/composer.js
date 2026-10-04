// ABOUTME: Renders the chat composer under the message column.
// ABOUTME: The form, model controls, and send button keep their existing ids.

import { el } from "../../ui/dom.js";
import { createIcon } from "../../ui/icons.js";

/** @param {ParentNode} root */
export function mountComposerChrome(root) {
  const inputArea = el("div", { class: "input-area" }, [
    el("div", { class: "queued-messages hidden", id: "queued-messages" }),
    el("div", { class: "extension-widgets hidden", id: "extension-widgets-above" }),
    el("form", { id: "chat-form" }, [
      el("div", { class: "composer-card", id: "composer-card" }, [
        el("div", { class: "approval-host hidden", id: "approval-bar" }),
        el("div", { class: "skill-slash-menu hidden", id: "skill-slash-menu" }),
        el("div", { class: "at-file-mention-menu hidden", id: "at-file-mention-menu" }),
        el("div", { class: "image-previews hidden", id: "image-previews" }),
        el("textarea", {
          id: "message-input",
          placeholder: "Message… Type / for commands, @ for files",
          "data-i18n-ph": "shell.typeAMessageOrUseToCallPlaceholder",
          autocomplete: "off",
          spellcheck: "false",
          rows: "2",
        }),
        el("div", { class: "composer-toolbar" }, [
          el("div", { class: "composer-toolbar-left" }, [
            el("div", { class: "composer-toolbar-actions" }, [
              el(
                "button",
                {
                  type: "button",
                  class: "composer-chip",
                  id: "guard-chip",
                  title: "Ask",
                  "data-i18n": "composer.guardAsk",
                  "aria-label": "Permission mode",
                  "data-i18n-aria-label": "keybindings.guard",
                  tabindex: "-1",
                },
                ["Ask"],
              ),
              el("div", { class: "model-dropdown", id: "model-dropdown" }, [
                el(
                  "button",
                  {
                    type: "button",
                    class: "ui-button ui-button--sm ui-button--ghost model-dropdown-btn",
                    id: "model-dropdown-btn",
                    title: "Switch model",
                    "data-i18n-title": "input.switchModel",
                    "aria-label": "Switch model",
                    "data-i18n-aria-label": "input.switchModel",
                    tabindex: "-1",
                  },
                  [
                    el("span", { class: "model-dropdown-label", id: "model-dropdown-label" }, [
                      "model",
                    ]),
                    createIcon("model-chevron", {
                      width: 10,
                      height: 6,
                      viewBox: "0 0 10 6",
                      className: "model-dropdown-chevron",
                    }),
                  ],
                ),
                el("div", { class: "model-dropdown-menu hidden", id: "model-dropdown-menu" }),
              ]),
              el("div", { class: "composer-more" }, [
                el(
                  "button",
                  {
                    type: "button",
                    class: "ui-icon-button ui-icon-button--sm ui-icon-button--ghost input-icon-btn",
                    id: "composer-more-btn",
                    title: "More",
                    "data-i18n-title": "composer.moreTools",
                    "aria-label": "More",
                    "data-i18n-aria-label": "composer.moreTools",
                    tabindex: "-1",
                  },
                  [createIcon("ellipsis", { size: 14 })],
                ),
                el(
                  "div",
                  { class: "composer-more-menu hidden", id: "composer-more-menu", role: "menu" },
                  [
                    el(
                      "button",
                      {
                        type: "button",
                        class: "thinking-tag off",
                        id: "thinking-btn",
                        role: "menuitem",
                        title: "Thinking effort controls reasoning depth. Click to cycle.",
                        "data-i18n-title": "settings.thinkingTitle",
                        "aria-label": "Thinking effort: off. Click to cycle reasoning depth.",
                        "data-i18n-aria-label": "shell.thinkingEffortOffClickToCycleReasoningLabel",
                        tabindex: "-1",
                        "data-i18n": "shell.thinkOff",
                      },
                      ["Think off"],
                    ),
                    el(
                      "button",
                      {
                        type: "button",
                        class: "composer-more-item",
                        id: "attach-btn",
                        role: "menuitem",
                        tabindex: "-1",
                      },
                      [
                        createIcon("paperclip", { size: 16 }),
                        el("span", { "data-i18n": "input.attachImage" }, ["Attach image"]),
                      ],
                    ),
                    el(
                      "button",
                      {
                        type: "button",
                        class: "composer-more-item",
                        id: "command-btn",
                        role: "menuitem",
                        tabindex: "-1",
                      },
                      [
                        createIcon("slash", { size: 16 }),
                        el("span", { "data-i18n": "input.commands" }, ["Commands"]),
                      ],
                    ),
                  ],
                ),
              ]),
              el("input", {
                type: "file",
                id: "image-input",
                accept: "image/*",
                multiple: "",
                style: "display: none",
              }),
              el("div", { class: "composer-toolbar-right" }, [
                el("span", {
                  class: "context-ring",
                  id: "context-ring",
                  title: "Context",
                  "data-i18n-title": "composer.context",
                  role: "img",
                  "aria-label": "Context",
                  "data-i18n-aria-label": "composer.context",
                }),
                el(
                  "button",
                  {
                    type: "submit",
                    id: "send-btn",
                    title: "Send message",
                    "data-i18n-title": "input.send",
                    "aria-label": "Send message",
                    "data-i18n-aria-label": "input.send",
                    tabindex: "-1",
                  },
                  [el("span", { class: "send-icon" }, [createIcon("arrow-up", { size: 16 })])],
                ),
                el(
                  "button",
                  {
                    type: "button",
                    id: "abort-btn",
                    class: "hidden",
                    title: "Abort (Esc)",
                    "data-i18n-title": "input.abort",
                    "aria-label": "Abort (Esc)",
                    "data-i18n-aria-label": "input.abort",
                    tabindex: "-1",
                  },
                  [createIcon("square", { size: 14, filled: true })],
                ),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
    el("div", { class: "extension-widgets hidden", id: "extension-widgets-below" }),
  ]);
  const nodes = [inputArea];
  /** @type {Array<() => void>} */
  const unbinders = [];
  root.append(inputArea);
  const refs = {
    inputArea,
    form: inputArea.querySelector("#chat-form"),
    composerCard: inputArea.querySelector("#composer-card"),
    messageInput: inputArea.querySelector("#message-input"),
    sendBtn: inputArea.querySelector("#send-btn"),
    abortBtn: inputArea.querySelector("#abort-btn"),
    thinkingBtn: inputArea.querySelector("#thinking-btn"),
    queuedMessages: inputArea.querySelector("#queued-messages"),
    widgetsAbove: inputArea.querySelector("#extension-widgets-above"),
    widgetsBelow: inputArea.querySelector("#extension-widgets-below"),
    skillSlashMenu: inputArea.querySelector("#skill-slash-menu"),
    atFileMentionMenu: inputArea.querySelector("#at-file-mention-menu"),
    imagePreviews: inputArea.querySelector("#image-previews"),
    imageInput: inputArea.querySelector("#image-input"),
    attachBtn: inputArea.querySelector("#attach-btn"),
    commandBtn: inputArea.querySelector("#command-btn"),
    modelDropdown: inputArea.querySelector("#model-dropdown"),
    modelDropdownBtn: inputArea.querySelector("#model-dropdown-btn"),
    modelDropdownLabel: inputArea.querySelector("#model-dropdown-label"),
    modelDropdownMenu: inputArea.querySelector("#model-dropdown-menu"),
    approvalBar: inputArea.querySelector("#approval-bar"),
    guardChip: inputArea.querySelector("#guard-chip"),
    contextRing: inputArea.querySelector("#context-ring"),
    moreBtn: inputArea.querySelector("#composer-more-btn"),
    moreMenu: inputArea.querySelector("#composer-more-menu"),
  };
  const moreBtn = refs.moreBtn;
  const moreMenu = refs.moreMenu;
  if (moreBtn instanceof HTMLElement && moreMenu instanceof HTMLElement) {
    const toolbar = moreBtn.closest(".composer-toolbar");
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.setAttribute("aria-expanded", "false");
    /** @param {boolean} open */
    const setMore = (open) => {
      moreMenu.classList.toggle("hidden", !open);
      toolbar?.classList.toggle("more-menu-open", open);
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setMore(moreMenu.classList.contains("hidden"));
    });
    for (const item of moreMenu.querySelectorAll(".composer-more-item")) {
      item.addEventListener("click", () => setMore(false));
    }
    /** @param {PointerEvent} event */
    const closeMore = (event) => {
      if (
        !(event.target instanceof Node) ||
        moreMenu.contains(event.target) ||
        moreBtn.contains(event.target)
      ) {
        return;
      }
      setMore(false);
    };
    /** @param {KeyboardEvent} event */
    const escapeMore = (event) => {
      if (event.key !== "Escape" || moreMenu.classList.contains("hidden")) return;
      // Escape also stops the turn; an open menu takes it first.
      event.stopPropagation();
      setMore(false);
    };
    document.addEventListener("pointerdown", closeMore);
    document.addEventListener("keydown", escapeMore, true);
    unbinders.push(() => {
      document.removeEventListener("pointerdown", closeMore);
      document.removeEventListener("keydown", escapeMore, true);
    });
  }
  return {
    refs,
    destroy() {
      for (const unbind of unbinders) unbind();
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * Composer controls this module creates.
 *
 * @param {ParentNode} [root]
 */
export function composerChromeRefs(root = document) {
  return {
    form: root.querySelector("#chat-form"),
    card:
      root.querySelector("#chat-form .composer-card") ||
      root.querySelector("#composer") ||
      root.querySelector(".composer"),
    messageInput: root.querySelector("#message-input"),
    abortBtn: root.querySelector("#abort-btn"),
    modelMenu: root.querySelector("#model-dropdown-menu"),
    approvalBar: root.querySelector("#approval-bar"),
    guardChip: root.querySelector("#guard-chip"),
    contextRing: root.querySelector("#context-ring"),
  };
}
