// ABOUTME: Small DOM builders shared by modules that own their markup.
// ABOUTME: Callers pass design-system class names; this file does not style anything.

/**
 * @typedef {Record<string, unknown> & {
 *   class?: string,
 *   text?: string,
 *   dataset?: Record<string, string>,
 *   aria?: Record<string, string>
 * }} ElProps
 */

/**
 * Create an element. `props.class` sets className, `props.text` sets textContent,
 * `props.dataset` and `props.aria` set data-* and aria-* attributes, and
 * `props.onClick` (any onX) registers a listener. Remaining props become attributes.
 * @param {string} tag
 * @param {ElProps} [props]
 * @param {Array<Node | string | false | null | undefined> | Node | string | false | null | undefined} [children]
 * @returns {HTMLElement | SVGElement}
 */
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg",
  "path",
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "rect",
  "g",
  "use",
  "defs",
  "clippath",
  "title",
]);

/**
 * @param {string} tag
 * @param {ElProps} [props]
 * @param {Array<Node | string | false | null | undefined> | Node | string | false | null | undefined} [children]
 * @returns {HTMLElement | SVGElement}
 */
export function el(tag, props = {}, children = []) {
  const svg = SVG_TAGS.has(tag);
  /** @type {HTMLElement | SVGElement} */
  const node = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class" && typeof value === "string") {
      node.setAttribute("class", value);
    } else if (key === "text" && (typeof value === "string" || typeof value === "number")) {
      node.textContent = String(value);
    } else if (key === "dataset" && value && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) node.dataset[name] = String(item);
    } else if (key === "aria" && value && typeof value === "object") {
      for (const [name, item] of Object.entries(value))
        node.setAttribute(`aria-${name}`, String(item));
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    } else if (value !== undefined && value !== null && typeof value !== "object") {
      node.setAttribute(key, String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child != null && child !== false) {
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
  }
  return node;
}

/** @param {HTMLElement | SVGElement} node @param {unknown} value */
export function text(node, value) {
  node.textContent = value == null ? "" : String(value);
  return node;
}

/** @param {HTMLElement | SVGElement} node */
export function clear(node) {
  node.replaceChildren();
  return node;
}
