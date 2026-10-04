// ABOUTME: Puts sanitized markdown markup into message nodes and enables code-block copy and file links.
// ABOUTME: Markup always passes through sanitizeMarkup; callers never assign innerHTML themselves.

import { t } from "../i18n/i18n.js";
import { fileSidebarRefs } from "../shell/chrome/file-sidebar.js";
import { copyText } from "./clipboard.js";
import { linkifyFileRefs } from "./file-refs.js";
import { sanitizeMarkup } from "./sanitize-markup.js";

/**
 * Read `.title` from an element that may belong to another document.
 * @param {Element | null | undefined} node
 * @returns {string}
 */
function elementTitle(node) {
  if (!node || !("title" in node)) return "";
  const title = /** @type {{ title?: unknown }} */ (node).title;
  return typeof title === "string" ? title : "";
}

/**
 * @param {HTMLElement} parent
 * @param {string} markup
 */
export function appendMarkup(parent, markup) {
  const parsed = new DOMParser().parseFromString(String(markup || ""), "text/html");
  sanitizeMarkup(parsed.body);
  parent.append(...Array.from(parsed.body.childNodes));
}

/**
 * @param {HTMLElement} parent
 * @param {string} markup
 */
export function replaceMarkup(parent, markup) {
  parent.replaceChildren();
  appendMarkup(parent, markup);
}

/**
 * @param {HTMLElement} root
 */
export function enhanceCodeBlocks(root) {
  root.querySelectorAll(".copy-btn").forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    if (button.dataset.bound === "true") return;
    const copyButton = button;
    copyButton.addEventListener("click", () => {
      const code = copyButton.closest(".code-block-wrapper")?.querySelector("code");
      if (!code) return;
      copyText(code.textContent || "").then(() => {
        copyButton.textContent = t("messages.copied");
        copyButton.classList.add("copied");
        setTimeout(() => {
          copyButton.textContent = t("messages.copy");
          copyButton.classList.remove("copied");
        }, 2000);
      });
    });
    copyButton.dataset.bound = "true";
  });
  linkifyFileRefs(root, {
    resolveAbsolute: (path) => {
      const pathEl = fileSidebarRefs().path;
      const workspace = elementTitle(pathEl);
      return [workspace.replace(/[\\/]+$/, ""), path].filter(Boolean).join("/");
    },
  });
}
