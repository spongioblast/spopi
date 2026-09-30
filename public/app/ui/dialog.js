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
 * Open a modal inside `#dialog-container` (or `container`).
 * Returns `{ close, element }`.
 * @param {{
 *   title?: string,
 *   body?: Node,
 *   actions?: { label: string, className?: string, onClick?: () => void }[],
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
  const root = container || document.getElementById("dialog-container");
  if (!root) throw new Error("dialog container is missing");
  const dialogRoot = root;
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
  if (actions.length > 0) {
    const bar = document.createElement("div");
    bar.className = "dialog-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className || "dialog-button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.onClick?.());
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

  function close() {
    if (closed) return;
    closed = true;
    unbind();
    unbindTrap();
    dialogRoot.removeEventListener("mousedown", onPointer);
    dialog.remove();
    if (!dialogRoot.querySelector(".dialog")) dialogRoot.classList.add("hidden");
    onClose?.();
  }

  unbind = createDialogEscape(close, {
    isActive: () => !closed && !dialogRoot.classList.contains("hidden"),
  });
  unbindTrap = bindFocusTrap(dialog);
  dialogRoot.addEventListener("mousedown", onPointer);

  const target = initialFocus || focusable(dialog)[0];
  target?.focus();
  return { close, element: dialog };
}

/**
 * Trap Tab inside a dialog. Returns an unbind function.
 * @param {HTMLElement} dialog
 */
export function bindFocusTrap(dialog) {
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
export function bindModal(element, { onClose, isActive } = {}) {
  if (!element.getAttribute("role")) element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  const unbindTrap = bindFocusTrap(element);
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
