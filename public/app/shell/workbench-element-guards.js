// ABOUTME: Narrows chrome refs to the small element shapes the workbench calls: click, focus, value, title.
// ABOUTME: Each guard checks the members it needs and returns null otherwise; no element is created here.

/**
 * @typedef {{
 *   click: () => void,
 * }} ClickableEl
 *
 * @typedef {{
 *   focus: () => void,
 *   placeholder: string,
 * }} SteerInputEl
 *
 * @typedef {{
 *   value: string,
 *   focus: () => void,
 *   selectionStart?: number | null,
 *   selectionEnd?: number | null,
 * }} TextInputEl
 *
 * @typedef {{
 *   title: string,
 * }} TitledEl
 *
 * @typedef {{
 *   tabIndex: number,
 *   title: string,
 *   classList: DOMTokenList,
 *   setAttribute: (name: string, value: string) => void,
 *   addEventListener: (
 *     type: string,
 *     listener: (event: Event) => void,
 *   ) => void,
 * }} StatusButtonEl
 */

/**
 * @param {Element | null | undefined} el
 * @returns {ClickableEl | null}
 */
export function asClickable(el) {
  if (!el || typeof el !== "object") return null;
  if (!("click" in el) || typeof el.click !== "function") return null;
  return /** @type {ClickableEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {SteerInputEl | null}
 */
export function asSteerInput(el) {
  if (!el || typeof el !== "object") return null;
  if (!("focus" in el) || typeof el.focus !== "function") return null;
  if (!("placeholder" in el)) return null;
  return /** @type {SteerInputEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {TextInputEl | null}
 */
export function asTextInput(el) {
  if (!el || typeof el !== "object") return null;
  if (!("value" in el) || !("focus" in el)) return null;
  return /** @type {TextInputEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {TitledEl | null}
 */
export function asTitled(el) {
  if (!el || typeof el !== "object") return null;
  if (!("title" in el)) return null;
  return /** @type {TitledEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {StatusButtonEl | null}
 */
export function asStatusButton(el) {
  if (!el || typeof el !== "object") return null;
  if (!("tabIndex" in el) || !("title" in el) || !("classList" in el)) return null;
  if (!("setAttribute" in el) || !("addEventListener" in el)) return null;
  return /** @type {StatusButtonEl} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
export function asHtmlHost(el) {
  if (!el || typeof el !== "object") return null;
  if (!("appendChild" in el) || !("classList" in el)) return null;
  return /** @type {HTMLElement} */ (el);
}
