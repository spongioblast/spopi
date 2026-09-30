// ABOUTME: Escapes text for HTML and strips dangerous markup from renderer output.
// ABOUTME: Callers insert the returned strings into innerHTML. This file does not parse Markdown.

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BLOCKED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FOREIGNOBJECT",
  "ANIMATE",
  "SET",
  "USE",
]);

/**
 * Strip dangerous elements and attributes from an already-parsed DOM subtree, in place.
 * @param {ParentNode} root
 */
export function sanitizeMarkup(root) {
  root.querySelectorAll("*").forEach((element) => {
    if (BLOCKED_TAGS.has(element.tagName)) {
      element.remove();
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "formaction" ||
        (name === "href" && !/^(https?:|mailto:|#)/i.test(value)) ||
        (name === "src" && !/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);)/i.test(value)) ||
        (name === "style" && /url\s*\(/i.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}
