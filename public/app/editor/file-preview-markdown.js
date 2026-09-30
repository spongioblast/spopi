// ABOUTME: Renders a Markdown preview and the copy buttons inside it.
// ABOUTME: The HTML is sanitized before it is inserted.

/**
 * Sanitized Markdown file preview.
 *
 * Wraps the existing renderMarkdown() with DOM-based sanitization:
 * - Explicit element allowlist
 * - All event-handler attributes removed
 * - Link protocols restricted to http, https, mailto, and #fragment
 * - Image protocols restricted to http, https, and data:image/*
 * - Inline styles limited to text-align values for table cells
 *
 * Copy-button onclick attributes from renderMarkdown() are stripped;
 * event delegation is installed when the fragment is mounted.
 */

import { t } from "../i18n/i18n.js";
import { copyText } from "../ui/clipboard.js";
import { renderMarkdown } from "../ui/markdown.js";

const ELEMENT_ALLOWLIST = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "button",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "div",
  "span",
  "input",
]);

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

const ALLOWED_CLASSES = new Map([
  ["button", new Set(["copy-btn"])],
  ["div", new Set(["code-block-wrapper", "code-block-header", "table-wrapper"])],
  ["img", new Set(["inline-image"])],
  ["li", new Set(["task-list-item"])],
  ["ul", new Set(["task-list"])],
]);

const ALLOWED_ATTRIBUTES = new Map([
  ["a", new Set(["href"])],
  ["button", new Set(["class"])],
  ["div", new Set(["class"])],
  ["img", new Set(["alt", "class", "src"])],
  ["input", new Set(["checked", "disabled", "type"])],
  ["li", new Set(["class"])],
  ["td", new Set(["style"])],
  ["th", new Set(["style"])],
  ["ul", new Set(["class"])],
]);

/**
 * @param {string | null | undefined} href
 * @returns {boolean}
 */
function isSafeLink(href) {
  if (!href) return true; // allow empty href (e.g. fragment-only)
  const trimmed = href.trim();
  // Allow fragment links.
  if (trimmed.startsWith("#")) return true;
  try {
    const url = new URL(trimmed, "http://dummy.invalid");
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} src
 * @returns {boolean}
 */
function isSafeImageSrc(src) {
  if (!src) return true;
  const trimmed = src.trim();
  // Allow data:image/* URIs.
  if (trimmed.startsWith("data:image/")) return true;
  try {
    const url = new URL(trimmed, "http://dummy.invalid");
    return SAFE_IMAGE_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function isSafeTextAlign(value) {
  const normalized = (value || "").trim().toLowerCase();
  return ["left", "center", "right"].includes(normalized);
}

/**
 * Sanitize a DOM node in-place: remove non-allowlisted elements and
 * dangerous attributes, validate URLs and styles.
 * @param {ParentNode} node
 * @param {object} [options]
 * @param {boolean} [options.convertedDocument]
 * @param {string} [options.remoteImageHiddenText]
 */
function sanitizeNode(node, { convertedDocument = false, remoteImageHiddenText } = {}) {
  const children = [...node.childNodes];
  for (const child of children) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = /** @type {HTMLElement} */ (child);

    const tagName = el.tagName.toLowerCase();
    if (!ELEMENT_ALLOWLIST.has(tagName)) {
      el.replaceWith(document.createTextNode(el.textContent || ""));
      continue;
    }

    if (tagName === "button" && !el.classList.contains("copy-btn")) {
      el.replaceWith(document.createTextNode(el.textContent || ""));
      continue;
    }
    if (tagName === "input" && el.getAttribute("type")?.toLowerCase() !== "checkbox") {
      el.remove();
      continue;
    }

    const allowedAttributes = ALLOWED_ATTRIBUTES.get(tagName) || new Set();
    for (const attr of [...el.attributes]) {
      const attrName = attr.name.toLowerCase();
      if (!allowedAttributes.has(attrName)) {
        el.removeAttribute(attr.name);
        continue;
      }

      if (attrName === "class") {
        const allowedClasses = ALLOWED_CLASSES.get(tagName) || new Set();
        const safeClasses = [...el.classList].filter((className) => allowedClasses.has(className));
        if (safeClasses.length > 0) {
          el.className = safeClasses.join(" ");
        } else {
          el.removeAttribute("class");
        }
        continue;
      }

      if (tagName === "a" && attrName === "href" && !isSafeLink(attr.value)) {
        el.removeAttribute("href");
        continue;
      }
      if (tagName === "img" && attrName === "src") {
        const allowed = convertedDocument
          ? attr.value.trim().toLowerCase().startsWith("data:image/")
          : isSafeImageSrc(attr.value);
        if (!allowed) {
          if (convertedDocument) {
            const replacement = document.createElement("span");
            replacement.className = "file-markdown-remote-image-hidden";
            replacement.textContent =
              remoteImageHiddenText || t("files.preview.markitdown.remoteImageHidden");
            el.replaceWith(replacement);
          } else {
            el.removeAttribute("src");
          }
          continue;
        }
      }
      if (
        attrName === "style" &&
        (!["td", "th"].includes(tagName) || !isSafeTextAlign(el.style.textAlign))
      ) {
        el.removeAttribute("style");
      } else if (attrName === "style") {
        el.setAttribute("style", `text-align: ${el.style.textAlign.toLowerCase()}`);
      }
    }

    if (tagName === "input") {
      el.setAttribute("type", "checkbox");
      el.setAttribute("disabled", "");
    }
    if (tagName === "button") {
      el.setAttribute("type", "button");
    }
    if (tagName === "a" && el.hasAttribute("href")) {
      el.setAttribute("rel", "noopener noreferrer");
      const href = el.getAttribute("href") || "";
      if (!href.trim().startsWith("#")) {
        el.setAttribute("target", "_blank");
      }
    }

    sanitizeNode(el, { convertedDocument, remoteImageHiddenText });
  }
}

/**
 * Render Markdown text into a sanitized DocumentFragment.
 * @param {unknown} markdownText
 * @param {object} [options]
 * @param {boolean} [options.convertedDocument]
 * @param {string} [options.remoteImageHiddenText]
 * @returns {DocumentFragment}
 */
export function renderFileMarkdown(markdownText, options = {}) {
  const rawHtml = renderMarkdown(String(markdownText ?? ""));
  const template = document.createElement("template");
  template.innerHTML = rawHtml;
  const fragment = template.content.cloneNode(true);
  sanitizeNode(/** @type {DocumentFragment} */ (fragment), options);
  return /** @type {DocumentFragment} */ (fragment);
}

/**
 * Attach copy-button event delegation to a mounted container.
 * Must be called AFTER the fragment from renderFileMarkdown() is inserted
 * into the DOM. The returned cleanup function removes the listener.
 * @param {Element} container
 * @returns {() => void}
 */
export function mountCopyButtonDelegation(container) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let feedbackTimer = null;
  /**
   * @param {MouseEvent} event
   */
  function handleClick(event) {
    const target = event.target;
    if (!target || !("closest" in target) || typeof target.closest !== "function") return;
    const btnNode = /** @type {Element} */ (target).closest(".copy-btn");
    if (!btnNode || !container.contains(btnNode)) return;
    // Locals so nested closures keep the early-return narrowing.
    const btn = /** @type {HTMLElement} */ (btnNode);

    const wrapper = btn.closest(".code-block-wrapper");
    if (!wrapper) return;

    const codeEl = wrapper.querySelector("code");
    if (!codeEl) return;

    const text = codeEl.textContent || "";
    const original = btn.textContent;
    /**
     * @param {string} label
     * @param {string} className
     */
    const showFeedback = (label, className) => {
      clearTimeout(feedbackTimer ?? undefined);
      btn.textContent = label;
      btn.classList.add(className);
      feedbackTimer = setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove(className);
      }, 1200);
    };

    copyText(text).then(
      () => showFeedback(t("messages.copied"), "copied"),
      () => showFeedback(t("files.preview.copyFailed"), "copy-failed"),
    );
  }

  container.addEventListener("click", /** @type {EventListener} */ (handleClick));
  return () => {
    clearTimeout(feedbackTimer ?? undefined);
    container.removeEventListener("click", /** @type {EventListener} */ (handleClick));
  };
}
