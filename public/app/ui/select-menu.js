// ABOUTME: Replaces a native select with the themed menu.
// ABOUTME: The underlying select stays the source of the value.

import { createIcon } from "./icons.js";

const enhanced = new WeakMap();
/** @type {{ close: () => void } | null} */
let openController = null;
let idSeq = 0;

/** @param {string} prefix */
function nextId(prefix) {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

/** @param {HTMLSelectElement} select */
function optionList(select) {
  return Array.from(select.options).map((option, index) => ({
    index,
    value: option.value,
    label: option.textContent.trim(),
    disabled: option.disabled,
  }));
}

/** @param {HTMLSelectElement} select */
function selectedLabel(select) {
  const selected = select.selectedOptions[0];
  if (selected) return selected.textContent.trim();
  return select.options[0]?.textContent.trim() ?? "";
}

/** @param {HTMLSelectElement} select */
export function enhanceSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return null;
  const existing = enhanced.get(select);
  if (existing) return existing;

  const isCompact =
    select.classList.contains("ui-select--sm") || select.classList.contains("pkg-browse-sort");
  const menu = document.createElement("div");
  menu.className = "ui-select-menu";
  if (isCompact) menu.classList.add("ui-select-menu--sm");
  for (const name of [...select.classList]) {
    if (name === "ui-select" || name.startsWith("ui-select--")) continue;
    menu.classList.add(name);
  }

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = isCompact ? "ui-select ui-select--sm" : "ui-select";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const valueEl = document.createElement("span");
  valueEl.className = "ui-select-value";
  const chevron = document.createElement("span");
  chevron.className = "ui-select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  const icon = createIcon("chevron-down", { size: 12 });
  if (icon) chevron.append(icon);
  trigger.append(valueEl, chevron);

  const listId = nextId("ui-select-list");
  trigger.setAttribute("aria-controls", listId);

  const list = document.createElement("div");
  list.id = listId;
  list.className = "ui-select-popover";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  const parent = select.parentNode;
  parent?.insertBefore(menu, select);
  menu.append(select, trigger);
  document.body.append(list);

  select.className = "ui-select-native";
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  let activeIndex = Math.max(0, select.selectedIndex);
  let open = false;
  let destroyed = false;

  function syncTrigger() {
    valueEl.textContent = selectedLabel(select);
    trigger.disabled = select.disabled;
    if (select.getAttribute("aria-invalid") === "true") {
      trigger.setAttribute("aria-invalid", "true");
    } else {
      trigger.removeAttribute("aria-invalid");
    }
    const label = select.getAttribute("aria-label");
    if (label) trigger.setAttribute("aria-label", label);
    else trigger.removeAttribute("aria-label");
  }

  function renderOptions() {
    const options = optionList(select);
    list.replaceChildren();
    for (const option of options) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ui-select-option";
      item.id = `${listId}-opt-${option.index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", option.value === select.value ? "true" : "false");
      item.tabIndex = -1;
      item.dataset.value = option.value;
      item.disabled = option.disabled;
      item.textContent = option.label;
      item.addEventListener("click", () => commit(option.value));
      list.append(item);
    }
    if (!options.some((option) => option.index === activeIndex)) {
      activeIndex = Math.max(0, select.selectedIndex);
    }
    paintActive();
  }

  /** @returns {HTMLButtonElement[]} */
  function optionButtons() {
    return [...list.querySelectorAll(".ui-select-option")].filter(
      (node) => node instanceof HTMLButtonElement,
    );
  }

  function paintActive() {
    const items = optionButtons();
    for (const [index, item] of items.entries()) {
      item.classList.toggle("is-active", index === activeIndex && !list.hidden);
      if (index === activeIndex && !list.hidden) {
        trigger.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView?.({ block: "nearest" });
      }
    }
    if (list.hidden) trigger.removeAttribute("aria-activedescendant");
  }

  function positionList() {
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    list.style.minWidth = `${Math.round(rect.width)}px`;
    list.style.left = `${Math.round(rect.left)}px`;
    const menuHeight = list.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceBelow < menuHeight && rect.top - gap > spaceBelow;
    const top = openUp ? Math.max(gap, rect.top - menuHeight - gap) : rect.bottom + gap;
    list.style.top = `${Math.round(top)}px`;
  }

  function close() {
    if (!open) return;
    open = false;
    if (openController === controller) openController = null;
    list.hidden = true;
    menu.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onWindowKeyDown, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", onScroll, true);
  }

  function openList() {
    if (open || trigger.disabled) return;
    openController?.close();
    open = true;
    openController = controller;
    activeIndex = Math.max(0, select.selectedIndex);
    renderOptions();
    list.hidden = false;
    menu.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    positionList();
    paintActive();
  }

  function toggle() {
    if (open) close();
    else openList();
  }

  /** @param {string} value */
  function commit(value) {
    const previous = select.value;
    select.value = value;
    syncTrigger();
    close();
    trigger.focus();
    if (select.value !== previous) {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /** @param {number} delta */
  function moveActive(delta) {
    const items = optionButtons();
    if (items.length === 0) return;
    let next = activeIndex;
    for (let step = 0; step < items.length; step += 1) {
      next = (next + delta + items.length) % items.length;
      if (!items[next].disabled) break;
    }
    activeIndex = next;
    paintActive();
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (!select.isConnected) {
      destroy();
      return;
    }
    const target = event.target;
    if (target instanceof Node && (menu.contains(target) || list.contains(target))) return;
    close();
  }

  /** @param {Event} event */
  function onScroll(event) {
    if (event.target instanceof Node && list.contains(event.target)) return;
    close();
  }

  /** @param {KeyboardEvent} event */
  function onWindowKeyDown(event) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      activeIndex = 0;
      paintActive();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      activeIndex = Math.max(0, optionButtons().length - 1);
      paintActive();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = optionButtons()[activeIndex];
      if (item && !item.disabled && item.dataset.value != null) commit(item.dataset.value);
    }
  }

  /** @param {KeyboardEvent} event */
  function onTriggerKeyDown(event) {
    if (trigger.disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
    }
  }

  function syncFromNative() {
    if (!select.isConnected) {
      destroy();
      return;
    }
    syncTrigger();
    renderOptions();
    if (open) positionList();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    close();
    observer.disconnect();
    removalObserver.disconnect();
    select.removeEventListener("change", syncFromNative);
    trigger.removeEventListener("click", toggle);
    trigger.removeEventListener("keydown", onTriggerKeyDown);
    list.remove();
    if (menu.contains(select) && menu.parentNode) {
      menu.parentNode.insertBefore(select, menu);
    }
    menu.remove();
    enhanced.delete(select);
  }

  trigger.addEventListener("click", toggle);
  trigger.addEventListener("keydown", onTriggerKeyDown);
  select.addEventListener("change", syncFromNative);

  const observer = new MutationObserver(syncFromNative);
  observer.observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-invalid", "aria-label"],
  });

  const removalObserver = new MutationObserver(() => {
    if (!select.isConnected) destroy();
  });
  const removalRoot = select.closest("#settings-panel") || document.body;
  removalObserver.observe(removalRoot, { childList: true, subtree: true });

  const controller = { close, destroy, sync: syncFromNative };
  enhanced.set(select, controller);
  syncFromNative();
  return controller;
}
