// ABOUTME: Shows an inline ask-user prompt inside the chat column.
// ABOUTME: Submitting or cancelling answers the extension request.

import { t } from "../i18n/i18n.js";
import { headerChromeRefs } from "../shell/chrome/chat.js";
import { parseDialogContent, parseOption } from "./dialog.js";

/**
 * @typedef {import("./dialog.js").DialogContent} DialogContent
 * @typedef {import("./dialog.js").DialogOption} DialogOption
 * @typedef {import("./dialog.js").DialogPreview} DialogPreview
 * @typedef {import("./dialog.js").DialogResult} DialogResult
 * @typedef {import("./dialog.js").ExtensionUiRequest} ExtensionUiRequest
 */

const MULTI_SELECT_HINT = "Enter the numbers of all that apply";
const CUSTOM_ANSWER_HINT = "Type your answer";
/** @type {unknown[]} */
const pendingCustomAnswers = [];

/**
 * @param {ExtensionUiRequest} request
 * @param {object} [options]
 * @param {Element | null} [options.container]
 * @param {Promise<unknown>} [options.dismissSignal]
 * @param {((card: HTMLElement) => void) | null} [options.onAnswered] runs once the card is settled
 * @returns {Promise<DialogResult> | null}
 */
export function showInlineExtensionPrompt(
  request,
  { container, dismissSignal, onAnswered = null } = {},
) {
  container ??= headerChromeRefs().messages;
  if (!container || !isInlineAskUserQuestionRequest(request)) return null;
  const host = container;
  const content = parseDialogContent(request);
  if (
    request.method === "input" &&
    isCustomAnswerInput(content) &&
    pendingCustomAnswers.length > 0
  ) {
    return Promise.resolve({ value: pendingCustomAnswers.shift() });
  }
  removeWelcome(host);
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "inline-prompt-card";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", t("extensions.prompt.extensionQuestionLabel"));

    // Guard against double-settling: a dismissSignal (session switched away,
    // or the user hit Stop/Abort) and a user click can otherwise both try to
    // resolve/markAnswered the same card. Once settled, later calls are
    // no-ops so a stale card never looks clickable while doing nothing.
    let settled = false;
    /**
     * @param {DialogResult} result
     */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      markAnswered(card, result);
      onAnswered?.(card);
      resolve(result);
    };
    dismissSignal?.then(() => settle({ cancelled: true }));

    const header = document.createElement("div");
    header.className = "inline-prompt-header";
    const eyebrow = document.createElement("span");
    eyebrow.className = "inline-prompt-eyebrow";
    eyebrow.textContent = content.header || t("extensionUi.question");
    const title = document.createElement("div");
    title.className = "inline-prompt-title";
    title.textContent = content.title || t("composer.chooseOption");
    header.append(eyebrow, title);
    card.appendChild(header);

    if (request.method === "select") {
      renderSelectPrompt(card, request, content, settle);
    } else {
      renderInputPrompt(card, request, content, settle);
    }

    host.appendChild(card);
    scrollTimeline(host);
  });
}

/**
 * @param {ExtensionUiRequest | null | undefined} request
 * @returns {boolean}
 */
export function isInlineAskUserQuestionRequest(request) {
  if (request?.type !== "extension_ui_request") return false;
  if (request.method === "select") {
    const options = request.options ?? [];
    return options.length > 0 && options.every((option) => parseOption(option).number);
  }
  if (request.method !== "input") return false;
  const content = parseDialogContent(request);
  if (isCustomAnswerInput(content) && pendingCustomAnswers.length > 0) return true;
  return Boolean(
    content.header &&
      (content.body.includes(MULTI_SELECT_HINT) ||
        content.title.includes(CUSTOM_ANSWER_HINT) ||
        content.body.includes(CUSTOM_ANSWER_HINT)),
  );
}

/**
 * @param {HTMLElement} card
 * @param {ExtensionUiRequest} request
 * @param {DialogContent} content
 * @param {(result: DialogResult) => void} resolve
 */
function renderSelectPrompt(card, request, content, resolve) {
  const layout = document.createElement("div");
  layout.className =
    content.previews.length > 0
      ? "inline-prompt-layout inline-prompt-layout--with-preview"
      : "inline-prompt-layout";
  const options = document.createElement("div");
  options.className = "inline-prompt-options";

  const previewPanel = content.previews.length > 0 ? createPreviewPanel(content.previews) : null;
  const previewByNumber = new Map(content.previews.map((preview) => [preview.number, preview]));
  const actions = createActions(() => finish({ cancelled: true }));

  for (const value of request.options ?? []) {
    const option = parseOption(value);
    const button = createOptionButton(option);
    button.addEventListener("mouseenter", () => {
      if (previewPanel && option.number)
        setPreview(previewPanel, previewByNumber.get(option.number));
    });
    button.addEventListener("focus", () => {
      if (previewPanel && option.number)
        setPreview(previewPanel, previewByNumber.get(option.number));
    });
    button.addEventListener("click", () => {
      if (isTypeSomethingOption(option)) {
        renderCustomAnswerInSelect(card, layout, actions, value, finish);
        return;
      }
      finish({ value });
    });
    options.appendChild(button);
  }
  layout.appendChild(options);
  if (previewPanel) layout.appendChild(previewPanel);
  card.appendChild(layout);
  card.appendChild(actions);

  /**
   * @param {DialogResult} result
   */
  function finish(result) {
    resolve(result);
  }
}

/**
 * @param {HTMLElement} card
 * @param {ExtensionUiRequest} request
 * @param {DialogContent} content
 * @param {(result: DialogResult) => void} resolve
 */
function renderInputPrompt(card, request, content, resolve) {
  const multiOptions = parseOptionsFromBody(content.body);
  if (multiOptions.length > 0) {
    renderMultiSelectInput(card, multiOptions, resolve);
    return;
  }

  const input = document.createElement("input");
  input.className = "inline-prompt-input";
  input.type = "text";
  input.placeholder = request.placeholder || "";
  card.appendChild(input);
  const actions = createActions(
    () => finish({ cancelled: true }),
    () => finish({ value: input.value }),
  );
  card.appendChild(actions);
  input.focus();

  /**
   * @param {DialogResult} result
   */
  function finish(result) {
    resolve(result);
  }
}

/**
 * @param {HTMLElement} card
 * @param {HTMLElement} layout
 * @param {HTMLElement} actions
 * @param {unknown} sentinelValue
 * @param {(result: DialogResult) => void} finish
 */
function renderCustomAnswerInSelect(card, layout, actions, sentinelValue, finish) {
  layout.hidden = true;
  actions.hidden = true;

  const customPanel = document.createElement("div");
  customPanel.className = "inline-prompt-custom";
  const input = document.createElement("input");
  input.className = "inline-prompt-input";
  input.type = "text";
  input.placeholder = t("extensions.prompt.typeACustomAnswerPlaceholder");
  const customActions = document.createElement("div");
  customActions.className = "inline-prompt-actions";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "inline-prompt-submit";
  submit.textContent = t("dialogs.submit");
  submit.addEventListener("click", () => {
    pendingCustomAnswers.push(input.value);
    finish({ value: sentinelValue });
  });

  const back = document.createElement("button");
  back.type = "button";
  back.className = "inline-prompt-cancel";
  back.textContent = t("workspace.back");
  back.addEventListener("click", () => {
    customPanel.remove();
    layout.hidden = false;
    actions.hidden = false;
  });

  customActions.append(submit, back);
  customPanel.append(input, customActions);
  card.appendChild(customPanel);
  input.focus();
}

/**
 * @param {HTMLElement} card
 * @param {DialogOption[]} options
 * @param {(result: DialogResult) => void} resolve
 */
function renderMultiSelectInput(card, options, resolve) {
  const list = document.createElement("div");
  list.className = "inline-prompt-options";
  /** @type {Set<string>} */
  const selected = new Set();
  for (const option of options) {
    const label = document.createElement("label");
    label.className = "inline-prompt-option inline-prompt-option--checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.number;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(option.number);
      else selected.delete(option.number);
    });
    const body = createOptionBody(option);
    label.append(checkbox, body);
    list.appendChild(label);
  }
  card.appendChild(list);

  const custom = document.createElement("input");
  custom.className = "inline-prompt-input";
  custom.type = "text";
  custom.placeholder = t("extensions.prompt.typeACustomAnswerPlaceholder");
  custom.addEventListener("input", () => {
    const disable = custom.value.trim().length > 0;
    for (const node of list.querySelectorAll("input[type='checkbox']")) {
      if (!("disabled" in node)) continue;
      const checkbox = /** @type {{ disabled: boolean }} */ (node);
      checkbox.disabled = disable;
    }
  });
  card.appendChild(custom);

  const actions = createActions(
    () => finish({ cancelled: true }),
    () => {
      const customValue = custom.value.trim();
      finish({
        value: customValue || [...selected].sort((a, b) => Number(a) - Number(b)).join(","),
      });
    },
  );
  card.appendChild(actions);

  /**
   * @param {DialogResult} result
   */
  function finish(result) {
    resolve(result);
  }
}

/**
 * @param {DialogOption} option
 * @returns {HTMLButtonElement}
 */
function createOptionButton(option) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inline-prompt-option";
  button.appendChild(createOptionBody(option));
  return button;
}

/**
 * @param {DialogOption} option
 * @returns {HTMLSpanElement}
 */
function createOptionBody(option) {
  const body = document.createElement("span");
  body.className = "inline-prompt-option-body";
  if (option.number) {
    const index = document.createElement("span");
    index.className = "inline-prompt-option-index";
    index.textContent = option.number;
    body.appendChild(index);
  }
  const text = document.createElement("span");
  text.className = "inline-prompt-option-text";
  const label = document.createElement("span");
  label.className = "inline-prompt-option-label";
  label.textContent = option.label;
  text.appendChild(label);
  if (option.description) {
    const description = document.createElement("span");
    description.className = "inline-prompt-option-description";
    description.textContent = option.description;
    text.appendChild(description);
  }
  body.appendChild(text);
  return body;
}

/**
 * @param {DialogPreview[]} previews
 * @returns {HTMLDivElement}
 */
function createPreviewPanel(previews) {
  const panel = document.createElement("div");
  panel.className = "inline-prompt-preview";
  setPreview(panel, previews[0]);
  return panel;
}

/**
 * @param {HTMLElement} panel
 * @param {DialogPreview | undefined} preview
 */
function setPreview(panel, preview) {
  panel.replaceChildren();
  if (!preview) {
    const empty = document.createElement("div");
    empty.className = "inline-prompt-preview-empty";
    empty.textContent = t("extensions.prompt.noPreview");
    panel.appendChild(empty);
    return;
  }
  const title = document.createElement("div");
  title.className = "inline-prompt-preview-title";
  title.textContent = `${preview.number}. ${preview.label}`;
  const body = document.createElement("pre");
  body.className = "inline-prompt-preview-body";
  body.textContent = preview.content;
  panel.append(title, body);
}

/**
 * @param {() => void} onCancel
 * @param {(() => void) | undefined} [onSubmit]
 * @returns {HTMLDivElement}
 */
function createActions(onCancel, onSubmit) {
  const actions = document.createElement("div");
  actions.className = "inline-prompt-actions";
  if (onSubmit) {
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "inline-prompt-submit";
    submit.textContent = t("dialogs.submit");
    submit.addEventListener("click", onSubmit);
    actions.appendChild(submit);
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "inline-prompt-cancel";
  cancel.textContent = t("shell.cancel");
  cancel.addEventListener("click", onCancel);
  actions.appendChild(cancel);
  return actions;
}

/**
 * @param {string} body
 * @returns {DialogOption[]}
 */
function parseOptionsFromBody(body) {
  return String(body)
    .split("\n")
    .map((line) => parseOption(line.trim()))
    .filter((option) => option.number);
}

/**
 * @param {DialogOption} option
 * @returns {boolean}
 */
function isTypeSomethingOption(option) {
  return option.label.replace(/\.$/, "").toLowerCase() === "type something";
}

/**
 * @param {DialogContent} content
 * @returns {boolean}
 */
function isCustomAnswerInput(content) {
  return content.title.includes(CUSTOM_ANSWER_HINT) || content.body.includes(CUSTOM_ANSWER_HINT);
}

/**
 * @param {HTMLElement} card
 * @param {DialogResult} result
 */
function markAnswered(card, result) {
  card.classList.add("answered");
  for (const control of card.querySelectorAll("button, input")) {
    if (!("disabled" in control)) continue;
    const disableable = /** @type {{ disabled: boolean }} */ (control);
    disableable.disabled = true;
  }
  for (const actions of card.querySelectorAll(".inline-prompt-actions")) {
    actions.remove();
  }
  const status = document.createElement("div");
  status.className = "inline-prompt-status";
  status.textContent = result.cancelled ? t("extensionUi.cancelled") : t("extensionUi.answered");
  card.appendChild(status);
}

/**
 * @param {Element} container
 */
function removeWelcome(container) {
  container.querySelector(".welcome")?.remove();
}

/**
 * @param {Element} container
 */
function scrollTimeline(container) {
  requestAnimationFrame(() => {
    if (!("scrollTop" in container) || !("scrollHeight" in container)) return;
    const el = /** @type {{ scrollTop: number, scrollHeight: number }} */ (container);
    el.scrollTop = el.scrollHeight;
  });
}
