// ABOUTME: Composer model menu: search, scoped stars, empty-state, open/close.
// ABOUTME: Selection and catalog fetches stay in the app composition root.

import { formatModelName, getModelSearchText } from "../session/session-log.js";
import { isSelectedModel, splitModelsByScope } from "./model-selection.js";

/**
 * @typedef {object} ModelDropdownModel
 * @property {string} id
 * @property {string} provider
 * @property {string} [name]
 * @property {number | string} [contextWindow]
 */

/**
 * @typedef {object} ModelDropdownElements
 * @property {Element | null | undefined} [menu]
 * @property {Element | null | undefined} [dropdown]
 * @property {Element | null | undefined} [toolbar]
 * @property {Element | null | undefined} [btn]
 */

/**
 * @typedef {object} ModelDropdownOptions
 * @property {(key: string, params?: Record<string, unknown>) => string} t
 * @property {ModelDropdownElements} elements
 * @property {() => { provider?: string, modelId?: string } | null | undefined} getSelection
 * @property {() => ModelDropdownModel[] | null | undefined} getAvailableModels
 * @property {() => string[] | null | undefined} getScopedModelIds
 * @property {(model: ModelDropdownModel, enabled: boolean) => Promise<string[] | null | undefined> | string[] | null | undefined} [setScopedModelIds]
 * @property {() => PromiseLike<unknown> | void | null | undefined} [loadScoped]
 * @property {(model: ModelDropdownModel) => Promise<unknown> | unknown} [onSelect]
 * @property {() => void} [onOpenSettings]
 */

/**
 * @param {ModelDropdownOptions} options
 */
export function createModelDropdown({
  t,
  elements,
  getSelection,
  getAvailableModels,
  getScopedModelIds,
  setScopedModelIds,
  loadScoped,
  onSelect,
  onOpenSettings,
}) {
  const { menu, dropdown, toolbar, btn } = elements;

  function close() {
    menu?.classList.add("hidden");
    dropdown?.classList.remove("open");
    toolbar?.classList.remove("model-menu-open");
    btn?.setAttribute("aria-expanded", "false");
  }

  /** @param {Element} container */
  function renderEmpty(container) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    const title = document.createElement("div");
    title.className = "model-dropdown-empty-title";
    title.textContent = t("models.emptyTitle");
    const message = document.createElement("div");
    message.textContent = t("models.emptyHelp");
    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "btn-primary model-dropdown-empty-action";
    settingsButton.textContent = t("shell.openSettings");
    settingsButton.addEventListener("click", () => {
      close();
      onOpenSettings?.();
    });
    empty.append(title, message, settingsButton);
    container.appendChild(empty);
  }

  /**
   * @param {ModelDropdownModel} model
   * @param {boolean} isScoped
   */
  function buildItem(model, isScoped) {
    const item = document.createElement("div");
    const selected = isSelectedModel(model, getSelection());
    item.className = `model-dropdown-item${selected ? " active" : ""}`;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "model-dropdown-item-main";
    const nameWrap = document.createElement("span");
    nameWrap.className = "model-dropdown-item-name";
    nameWrap.textContent = formatModelName(model);
    if (model.provider && model.provider !== "anthropic") {
      const provider = document.createElement("span");
      provider.className = "model-dropdown-item-provider";
      provider.textContent = model.provider;
      nameWrap.appendChild(provider);
    }
    const context = document.createElement("span");
    context.className = "model-dropdown-item-ctx";
    context.textContent = model.contextWindow
      ? `${(Number(model.contextWindow) / 1000).toFixed(0)}k`
      : "";
    main.append(nameWrap, context);
    main.addEventListener("click", () => {
      close();
      void onSelect?.(model);
    });

    const star = document.createElement("button");
    star.type = "button";
    star.className = `model-dropdown-star${isScoped ? " active" : ""}`;
    star.textContent = isScoped ? "\u2605" : "\u2606";
    star.setAttribute("aria-label", t(isScoped ? "models.removeScoped" : "models.addScoped"));
    star.addEventListener("click", async (event) => {
      event.stopPropagation();
      const next = await setScopedModelIds?.(model, !isScoped);
      if (next && menu && !menu.classList.contains("hidden")) {
        const items = menu.querySelector(".model-dropdown-items");
        const search = /** @type {HTMLInputElement | null} */ (
          menu.querySelector(".model-dropdown-search")
        );
        if (items) renderItems(items, search?.value ?? "");
      }
    });
    item.append(main, star);
    return item;
  }

  /**
   * @param {Element} container
   * @param {string} label
   * @param {ModelDropdownModel[]} models
   * @param {boolean} isScoped
   */
  function appendSection(container, label, models, isScoped) {
    if (models.length === 0) return;
    const heading = document.createElement("div");
    heading.className = "model-dropdown-section";
    heading.textContent = label;
    container.appendChild(heading);
    for (const model of models) container.appendChild(buildItem(model, isScoped));
  }

  /**
   * @param {Element} container
   * @param {string} [filter]
   */
  function renderItems(container, filter = "") {
    container.replaceChildren();
    const availableModels = getAvailableModels() || [];
    if (availableModels.length === 0) {
      renderEmpty(container);
      return;
    }
    const query = filter.trim().toLowerCase();
    const matchingModels = query
      ? availableModels.filter((model) => getModelSearchText(model).includes(query))
      : availableModels;
    if (matchingModels.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-dropdown-empty";
      empty.textContent = t("shell.noModelsMatchYourSearch");
      container.appendChild(empty);
      return;
    }
    const { scoped, remaining } = splitModelsByScope(matchingModels, getScopedModelIds());
    appendSection(container, t("models.scoped"), scoped, true);
    appendSection(container, t("models.allEnabled"), remaining, false);
  }

  function renderMenu() {
    const menuEl = menu;
    if (!menuEl) return;
    menuEl.replaceChildren();
    const search = document.createElement("input");
    search.className = "model-dropdown-search";
    search.placeholder = t("models.searchPlaceholder");
    search.type = "text";
    menuEl.appendChild(search);
    const itemsContainer = document.createElement("div");
    itemsContainer.className = "model-dropdown-items";
    menuEl.appendChild(itemsContainer);
    renderItems(itemsContainer);
    const loaded = loadScoped?.();
    if (loaded && typeof loaded.then === "function") {
      void loaded.then(() => {
        if (!menuEl.classList.contains("hidden")) renderItems(itemsContainer, search.value);
      });
    }
    search.addEventListener("input", () => renderItems(itemsContainer, search.value));
    search.addEventListener("keydown", (event) => {
      const keyEvent = /** @type {KeyboardEvent} */ (event);
      if (keyEvent.key === "Escape") {
        close();
        keyEvent.stopPropagation();
      }
      if (keyEvent.key === "Enter") {
        const first = itemsContainer.querySelector(".model-dropdown-item");
        if (first && "click" in first && typeof first.click === "function") first.click();
      }
    });
  }

  function open() {
    const menuEl = menu;
    if (!menuEl) return;
    renderMenu();
    menuEl.classList.remove("hidden");
    dropdown?.classList.add("open");
    toolbar?.classList.add("model-menu-open");
    btn?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      const search = /** @type {HTMLInputElement | null} */ (
        menuEl.querySelector(".model-dropdown-search")
      );
      search?.focus();
    });
  }

  return { open, close, renderMenu };
}
