// ABOUTME: Settings row, toggle, select, and field builders for pages that render themselves.
// ABOUTME: Uses design-system classes only; pages pass translated labels in.

import { el } from "./dom.js";
import { enhanceSelect } from "./select-menu.js";

/**
 * The page title every Settings page starts with, then its body.
 * @param {string} title
 * @param {string} titleKey
 * @param {Array<Node | string | false | null | undefined>} children
 */
export function settingsPage(title, titleKey, children) {
  const heading = /** @type {HTMLElement} */ (el("h3", { text: title }));
  heading.dataset.i18n = titleKey;
  return [
    el("div", { class: "settings-header" }, [heading]),
    el("div", { class: "settings-body" }, children),
  ];
}

/**
 * @param {string} label
 * @param {{ i18n?: string }} [options]
 */
export function sectionTitle(label, { i18n } = {}) {
  const node = /** @type {HTMLElement} */ (
    el("div", { class: "settings-section-title", text: label })
  );
  if (i18n) node.dataset.i18n = i18n;
  return node;
}

/**
 * @param {{
 *   label?: string,
 *   description?: string,
 *   control?: Node | null,
 *   id?: string,
 *   labelKey?: string,
 *   descriptionKey?: string,
 * }} [options]
 */
export function row({ label, description, control, id, labelKey, descriptionKey } = {}) {
  /** @type {HTMLElement} */
  let labelNode;
  if (description) {
    const main = /** @type {HTMLElement} */ (
      el("span", { class: "settings-label-main", text: label })
    );
    const sub = /** @type {HTMLElement} */ (
      el("span", { class: "settings-label-sub", text: description })
    );
    if (labelKey) main.dataset.i18n = labelKey;
    if (descriptionKey) sub.dataset.i18n = descriptionKey;
    labelNode = /** @type {HTMLElement} */ (
      el("span", { class: "settings-label settings-label-stack" }, [main, sub])
    );
  } else {
    labelNode = /** @type {HTMLElement} */ (el("span", { class: "settings-label", text: label }));
    if (labelKey) labelNode.dataset.i18n = labelKey;
  }
  /** @type {{ class: string, id?: string }} */
  const props = { class: "settings-row" };
  if (id) props.id = id;
  return el("div", props, [labelNode, control]);
}

/**
 * Five-dot level control. The same track the thinking-effort slider uses.
 * `levels` are `{ value, label, key }`. `ends` labels the two outer captions.
 * @param {{
 *   id?: string,
 *   nameId?: string,
 *   markerId?: string,
 *   stepsId?: string,
 *   radioName?: string,
 *   levels?: Array<{ value: string, label: string, key?: string }>,
 *   ends?: {
 *     start?: string,
 *     current?: string,
 *     end?: string,
 *     startKey?: string,
 *     currentKey?: string,
 *     endKey?: string,
 *   },
 *   value?: string,
 *   label?: string,
 *   labelKey?: string,
 * }} [options]
 */
export function segmentedLevel({
  id,
  nameId,
  markerId,
  stepsId,
  radioName,
  levels = [],
  ends = {},
  value,
  label,
  labelKey,
} = {}) {
  const start = /** @type {HTMLElement} */ (el("span", { text: ends.start ?? "" }));
  const current = /** @type {HTMLElement} */ (
    el("span", {
      class: "thinking-effort-name",
      id: nameId,
      text: ends.current ?? "",
    })
  );
  const end = /** @type {HTMLElement} */ (el("span", { text: ends.end ?? "" }));
  if (ends.startKey) start.dataset.i18n = ends.startKey;
  if (ends.currentKey) current.dataset.i18n = ends.currentKey;
  if (ends.endKey) end.dataset.i18n = ends.endKey;
  const marker = el("span", {
    class: "thinking-effort-thumb",
    id: markerId,
    "aria-hidden": "true",
  });
  const dots = levels.map((level) => {
    const input = /** @type {HTMLInputElement} */ (
      el("input", {
        type: "radio",
        class: "thinking-effort-dot",
        name: radioName,
        value: level.value,
        "aria-label": level.label,
        title: level.label,
      })
    );
    input.dataset.level = level.value;
    if (level.key) {
      input.dataset.i18nAriaLabel = level.key;
      input.dataset.i18nTitle = level.key;
    }
    if (level.value === value) input.checked = true;
    return input;
  });
  const group = /** @type {HTMLElement} */ (
    el(
      "div",
      {
        class: "thinking-effort",
        id,
        role: "radiogroup",
        "aria-label": label,
      },
      [
        el("div", { class: "thinking-effort-ends" }, [start, current, end]),
        el("div", { class: "thinking-effort-track", id: stepsId }, [marker, ...dots]),
      ],
    )
  );
  if (labelKey) group.dataset.i18nAriaLabel = labelKey;
  return group;
}

/**
 * @param {{
 *   id?: string,
 *   checked?: boolean,
 *   onChange?: (next: boolean) => void,
 *   label?: string,
 * }} [options]
 */
export function toggle({ id, checked = false, onChange, label } = {}) {
  const button = /** @type {HTMLButtonElement} */ (
    el("button", {
      class: checked ? "settings-toggle on" : "settings-toggle",
      type: "button",
      id,
      role: "switch",
      "aria-checked": checked ? "true" : "false",
      "aria-label": label,
    })
  );
  button.addEventListener("click", () => {
    const next = !button.classList.contains("on");
    button.classList.toggle("on", next);
    button.setAttribute("aria-checked", next ? "true" : "false");
    onChange?.(next);
  });
  return button;
}

/**
 * @param {{
 *   id?: string,
 *   options?: Array<{ value: string, label: string }>,
 *   value?: string,
 *   onChange?: (value: string) => void,
 *   label?: string,
 *   className?: string,
 * }} [options]
 */
export function select({ id, options = [], value, onChange, label, className } = {}) {
  const node = /** @type {HTMLSelectElement} */ (
    el("select", {
      class: className || "ui-select",
      id,
      "aria-label": label,
    })
  );
  for (const option of options) {
    const item = /** @type {HTMLOptionElement} */ (
      el("option", { value: option.value, text: option.label })
    );
    if (option.value === value) item.selected = true;
    node.append(item);
  }
  node.addEventListener("change", () => onChange?.(node.value));
  if (node.isConnected) enhanceSelect(node);
  else
    queueMicrotask(() => {
      if (node.isConnected) enhanceSelect(node);
    });
  return node;
}

/**
 * @param {{
 *   id?: string,
 *   value?: string | number | null,
 *   onChange?: (value: number) => void,
 *   min?: number | string | null,
 *   max?: number | string | null,
 *   step?: number | string | null,
 *   label?: string,
 *   labelKey?: string,
 *   className?: string,
 *   inputMode?: string,
 * }} [options]
 */
export function numberField({
  id,
  value,
  onChange,
  min,
  max,
  step,
  label,
  labelKey,
  className,
  inputMode,
} = {}) {
  const input = /** @type {HTMLInputElement} */ (
    el("input", {
      type: "number",
      class: className ? `ui-input ${className}` : "ui-input",
      id,
      value: value ?? "",
      "aria-label": label,
    })
  );
  if (labelKey) input.dataset.i18nAriaLabel = labelKey;
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (step != null) input.step = String(step);
  if (inputMode) input.inputMode = inputMode;
  input.addEventListener("change", () => onChange?.(Number(input.value)));
  return input;
}

/**
 * @param {{
 *   id?: string,
 *   value?: string | null,
 *   onChange?: (value: string) => void,
 *   label?: string,
 * }} [options]
 */
export function textField({ id, value, onChange, label } = {}) {
  const input = /** @type {HTMLInputElement} */ (
    el("input", {
      type: "text",
      class: "ui-input",
      id,
      value: value ?? "",
      "aria-label": label,
    })
  );
  input.addEventListener("input", () => onChange?.(input.value));
  return input;
}
