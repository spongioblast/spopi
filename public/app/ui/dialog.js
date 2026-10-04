// ABOUTME: Modal dialogs: overlay, focus trap, Escape, and click-outside.
// ABOUTME: Nested dialogs share one stack and close from the top.

import { t } from "../i18n/i18n.js";

/**
 * @typedef {{ onClose: () => void, isActive: () => boolean }} DialogEscapeEntry
 */

/** @type {DialogEscapeEntry[]} */
const stack = [];

function topActive() {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry.isActive()) return entry;
  }
  return null;
}

/**
 * Register Escape to dismiss the current dialog. Nested calls close the
 * topmost active dialog first. Returns an unsubscribe function.
 * @param {() => void} onClose
 * @param {{ isActive?: () => boolean }} [options]
 */
export function createDialogEscape(onClose, { isActive } = {}) {
  const entry = {
    onClose,
    isActive: typeof isActive === "function" ? isActive : () => true,
  };
  stack.push(entry);

  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (event.defaultPrevented) return;
    if (topActive() !== entry) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onClose();
  };
  document.addEventListener("keydown", onKeyDown, true);

  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
    document.removeEventListener("keydown", onKeyDown, true);
    const index = stack.lastIndexOf(entry);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function dialogOwnsEscape() {
  return topActive() !== null;
}

/** Close the topmost active dialog. Returns false when the stack is empty. */
export function closeTop() {
  const entry = topActive();
  if (!entry) return false;
  entry.onClose();
  return true;
}

/**
 * @param {Element} node
 * @returns {node is HTMLElement}
 */
function isEnabled(node) {
  return node instanceof HTMLElement && !node.hasAttribute("disabled") && node.tabIndex !== -1;
}

/**
 * @param {HTMLElement} dialog
 * @returns {HTMLElement[]}
 */
function focusable(dialog) {
  return [...dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]")].filter(
    isEnabled,
  );
}

/**
 * The shared modal root, unless the caller brings its own container.
 * @param {HTMLElement | null} [container]
 * @returns {HTMLElement | null}
 */
export function getDialogRoot(container) {
  return container || document.getElementById("dialog-container");
}

/**
 * Open a modal inside `#dialog-container` (or `container`).
 * Returns `{ close, element }`. Focus goes back to the element that had it
 * when the dialog opened. Enter runs the `primary` action unless focus is in a
 * text field or on a button.
 * @param {{
 *   title?: string,
 *   body?: Node,
 *   actions?: { label: string, className?: string, onClick?: () => void, primary?: boolean }[],
 *   onClose?: () => void,
 *   initialFocus?: HTMLElement,
 *   container?: HTMLElement | null,
 *   className?: string,
 *   closeOnBackdrop?: boolean
 * }} [options]
 */
export function openDialog({
  title,
  body,
  actions = [],
  onClose,
  initialFocus,
  container,
  className,
  closeOnBackdrop = true,
} = {}) {
  const root = getDialogRoot(container);
  if (!root) throw new Error("dialog container is missing");
  const dialogRoot = root;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialogRoot.classList.remove("hidden");
  const dialog = document.createElement("div");
  dialog.className = className ? `dialog ${className}` : "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  if (title) {
    const heading = document.createElement("div");
    heading.className = "dialog-title";
    heading.id = "dialog-title";
    heading.textContent = title;
    dialog.setAttribute("aria-labelledby", "dialog-title");
    dialog.append(heading);
  }
  if (body) dialog.append(body);
  /** @type {HTMLButtonElement | null} */
  let primaryButton = null;
  if (actions.length > 0) {
    const bar = document.createElement("div");
    bar.className = "dialog-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className || "dialog-button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.onClick?.());
      if (action.primary) primaryButton = button;
      bar.append(button);
    }
    dialog.append(bar);
  }
  dialogRoot.append(dialog);

  let closed = false;
  let unbind = () => {};
  let unbindTrap = () => {};
  /** @param {MouseEvent} event */
  const onPointer = (event) => {
    if (!closeOnBackdrop) return;
    if (event.target === dialogRoot) close();
  };
  /** @param {KeyboardEvent} event */
  const onEnter = (event) => {
    if (event.key !== "Enter" || event.isComposing || event.defaultPrevented) return;
    if (!primaryButton || primaryButton.disabled) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, a, textarea, select, input")) {
      return;
    }
    event.preventDefault();
    primaryButton.click();
  };
  dialog.addEventListener("keydown", onEnter);

  function close() {
    if (closed) return;
    closed = true;
    unbind();
    unbindTrap();
    dialogRoot.removeEventListener("mousedown", onPointer);
    dialog.removeEventListener("keydown", onEnter);
    dialog.remove();
    if (!dialogRoot.querySelector(".dialog")) dialogRoot.classList.add("hidden");
    onClose?.();
    if (opener?.isConnected && !dialogRoot.querySelector(".dialog")) opener.focus();
  }

  unbind = createDialogEscape(close, {
    isActive: () => !closed && !dialogRoot.classList.contains("hidden"),
  });
  unbindTrap = trapFocus(dialog);
  dialogRoot.addEventListener("mousedown", onPointer);

  const target = initialFocus || focusable(dialog)[0];
  target?.focus();
  return { close, element: dialog };
}

/**
 * Trap Tab inside a dialog. Returns an unbind function.
 * @param {HTMLElement} dialog
 */
export function trapFocus(dialog) {
  /** @param {KeyboardEvent} event */
  const onTab = (event) => {
    if (event.key !== "Tab") return;
    const items = focusable(dialog);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener("keydown", onTab);
  return () => dialog.removeEventListener("keydown", onTab);
}

/**
 * Mark an existing surface as a modal and trap focus. Escape uses onClose.
 * @param {HTMLElement} element
 * @param {{ onClose?: () => void, isActive?: () => boolean }} [options]
 */
export function trapModal(element, { onClose, isActive } = {}) {
  if (!element.getAttribute("role")) element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  const unbindTrap = trapFocus(element);
  const unbindEscape = onClose
    ? createDialogEscape(onClose, {
        isActive: () => {
          const visible = element.isConnected && !element.hidden && !element.closest(".hidden");
          return visible && (isActive ? isActive() : true);
        },
      })
    : () => {};
  return () => {
    unbindTrap();
    unbindEscape();
  };
}

/**
 * @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title = "",
  message = "",
  confirmLabel,
  cancelLabel,
  danger = false,
} = {}) {
  const okLabel = confirmLabel || t("actions.confirm");
  const noLabel = cancelLabel || t("actions.cancel");
  return new Promise((resolve) => {
    let settled = false;
    let accepted = false;
    const finish = (/** @type {boolean} */ value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = document.createElement("p");
    body.textContent = message;
    const handle = openDialog({
      title,
      body,
      actions: [
        {
          label: noLabel,
          className: "ui-button ui-button--secondary",
          onClick: () => handle.close(),
        },
        {
          label: okLabel,
          className: danger ? "ui-button ui-button--danger" : "ui-button ui-button--primary",
          primary: true,
          onClick: () => {
            accepted = true;
            handle.close();
          },
        },
      ],
      onClose: () => finish(accepted),
    });
  });
}

/**
 * A one-field text dialog. Resolves to the trimmed text, or null on cancel.
 * @param {{ title?: string, label?: string, value?: string, placeholder?: string, confirmLabel?: string }} [options]
 * @returns {Promise<string | null>}
 */
export function promptDialog({
  title = "",
  label = "",
  value = "",
  placeholder = "",
  confirmLabel,
} = {}) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let result = null;
    const body = document.createElement("label");
    body.className = "dialog-field";
    if (label) {
      const caption = document.createElement("span");
      caption.className = "dialog-field-label";
      caption.textContent = label;
      body.append(caption);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ui-input";
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    body.append(input);
    const submit = () => {
      result = input.value.trim();
      handle.close();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      submit();
    });
    const handle = openDialog({
      title,
      body,
      initialFocus: input,
      actions: [
        {
          label: t("actions.cancel"),
          className: "ui-button ui-button--secondary",
          onClick: () => handle.close(),
        },
        {
          label: confirmLabel || t("actions.confirm"),
          className: "ui-button ui-button--primary",
          primary: true,
          onClick: submit,
        },
      ],
      onClose: () => resolve(result),
    });
    input.select();
  });
}
