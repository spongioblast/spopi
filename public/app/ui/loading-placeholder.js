// ABOUTME: Shared loading placeholder: spinner icon plus localized loading text.
// ABOUTME: Visible copy is the label; the CSS spinner is decorative.

/**
 * @param {{ label?: string, className?: string, tag?: string }} [options]
 */
export function createLoadingPlaceholder({ label = "", className = "", tag = "div" } = {}) {
  const node = document.createElement(tag);
  applyLoadingPlaceholder(node, { label, className });
  return node;
}

/**
 * @param {HTMLElement | null | undefined} node
 * @param {{ label?: string, className?: string }} [options]
 */
export function applyLoadingPlaceholder(node, { label, className } = {}) {
  if (!node) return node;
  if (className) {
    for (const name of className.split(/\s+/).filter(Boolean)) node.classList.add(name);
  }
  node.classList.add("ui-loading");
  node.replaceChildren();
  node.removeAttribute("data-i18n");
  node.removeAttribute("data-i18n-aria-label");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("aria-busy", "true");
  if (label) node.textContent = label;
  node.removeAttribute("aria-label");
  return node;
}

/** @param {HTMLElement | null | undefined} node */
export function clearLoadingPlaceholder(node) {
  if (!node) return node;
  node.classList.remove("ui-loading");
  node.removeAttribute("aria-busy");
  return node;
}
