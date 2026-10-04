// ABOUTME: Fixed-position context menu shared by sessions and the file tree.
// ABOUTME: One menu at a time; Escape and outside pointerdown close it.

/** @type {HTMLDivElement | null} */
let menuEl = null;
/** @type {((event: KeyboardEvent) => void) | null} */
let onKey = null;
/** @type {((event: PointerEvent) => void) | null} */
let onPointer = null;

export function closeContextMenu() {
  menuEl?.remove();
  menuEl = null;
  if (onKey) document.removeEventListener("keydown", onKey, true);
  if (onPointer) document.removeEventListener("pointerdown", onPointer, true);
  onKey = null;
  onPointer = null;
}

/**
 * @param {{
 *   event?: { preventDefault?: () => void, clientX?: number, clientY?: number },
 *   items?: {
 *     separator?: boolean,
 *     label?: string,
 *     hint?: string,
 *     disabled?: boolean,
 *     action?: () => void,
 *   }[]
 * }} [options]
 */
export function showContextMenu({ event, items = [] } = {}) {
  event?.preventDefault?.();
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ui-context-menu session-context-menu";
  menu.setAttribute("role", "menu");

  for (const entry of items) {
    if (entry.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement("div");
    row.className = "context-menu-item";
    row.setAttribute("role", "menuitem");
    if (entry.hint) {
      row.classList.add("has-hint");
      const label = document.createElement("span");
      label.textContent = entry.label ?? "";
      const hint = document.createElement("span");
      hint.className = "context-menu-hint";
      hint.textContent = entry.hint;
      row.append(label, hint);
    } else {
      row.textContent = entry.label ?? "";
    }
    row.tabIndex = -1;
    if (entry.disabled) {
      row.classList.add("is-disabled");
      row.setAttribute("aria-disabled", "true");
    } else {
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeContextMenu();
        entry.action?.();
      });
    }
    menu.appendChild(row);
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const width = rect.width || 220;
  const height = rect.height || 40;
  let x = event?.clientX ?? 0;
  let y = event?.clientY ?? 0;
  if (x + width > window.innerWidth) x = window.innerWidth - width - 8;
  if (y + height > window.innerHeight) y = window.innerHeight - height - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menuEl = menu;
  const enabled = () =>
    [...menu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')].filter(
      (node) => node instanceof HTMLElement,
    );
  /** @param {number} index */
  const focusItem = (index) => {
    const items = enabled();
    if (items.length === 0) return;
    const next = items[(index + items.length) % items.length];
    for (const item of items) item.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  };
  focusItem(0);

  /** @param {KeyboardEvent} keydown */
  onKey = (keydown) => {
    const items = enabled();
    const current =
      document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
    if (keydown.key === "Escape") {
      keydown.preventDefault();
      closeContextMenu();
      return;
    }
    if (keydown.key === "ArrowDown") {
      keydown.preventDefault();
      focusItem(current < 0 ? 0 : current + 1);
    } else if (keydown.key === "ArrowUp") {
      keydown.preventDefault();
      focusItem(current < 0 ? items.length - 1 : current - 1);
    } else if (keydown.key === "Home") {
      keydown.preventDefault();
      focusItem(0);
    } else if (keydown.key === "End") {
      keydown.preventDefault();
      focusItem(items.length - 1);
    } else if ((keydown.key === "Enter" || keydown.key === " ") && items.length > 0) {
      keydown.preventDefault();
      (document.activeElement instanceof HTMLElement && items.includes(document.activeElement)
        ? document.activeElement
        : items[0]
      ).click();
    }
  };
  /** @param {PointerEvent} pointer */
  onPointer = (pointer) => {
    if (!(pointer.target instanceof Node) || !menu.contains(pointer.target)) closeContextMenu();
  };
  document.addEventListener("keydown", onKey, true);
  const pointerListener = onPointer;
  queueMicrotask(() => {
    if (pointerListener) document.addEventListener("pointerdown", pointerListener, true);
  });
  return menu;
}

const contextMenuHosts = new WeakSet();

/** @param {EventTarget | null | undefined} element */
export function registerContextMenuHost(element) {
  if (element instanceof Element) contextMenuHosts.add(element);
}

/** @param {EventTarget | null | undefined} node */
function hasContextMenuHost(node) {
  let current = node instanceof Element ? node : null;
  while (current) {
    if (contextMenuHosts.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * On a touch screen a 500 ms press on a registered host opens its context menu.
 * Moving more than 8 px, lifting, or scrolling cancels it.
 */
export function createLongPress() {
  let pressTimer = 0;
  let pressX = 0;
  let pressY = 0;

  const cancel = () => {
    window.clearTimeout(pressTimer);
    pressTimer = 0;
  };

  /** @param {PointerEvent} event */
  const onDown = (event) => {
    cancel();
    if (document.body.dataset.pointer !== "coarse") return;
    if (!hasContextMenuHost(event.target)) return;
    pressX = event.clientX;
    pressY = event.clientY;
    const point = event;
    pressTimer = window.setTimeout(() => {
      pressTimer = 0;
      const node = point.target;
      if (!(node instanceof Element) || !hasContextMenuHost(node)) return;
      node.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: point.clientX,
          clientY: point.clientY,
        }),
      );
    }, 500);
  };

  /** @param {PointerEvent} event */
  const onMove = (event) => {
    if (!pressTimer) return;
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 8) cancel();
  };

  document.addEventListener("pointerdown", onDown);
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", cancel);
  document.addEventListener("pointercancel", cancel);
  document.addEventListener("scroll", cancel, true);
  return {
    destroy() {
      cancel();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cancel);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("scroll", cancel, true);
    },
  };
}
