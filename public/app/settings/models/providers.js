// ABOUTME: Provider rows and model lists on the Models settings page.
// ABOUTME: Visibility changes go through the config gateway.

import { t } from "../../i18n/i18n.js";

/**
 * @typedef {{
 *   status?: string,
 *   latencyMs?: number,
 *   error?: string,
 * }} ModelHealthState
 *
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   provider?: string,
 *   available?: boolean,
 *   visible?: boolean,
 *   health?: ModelHealthState,
 * }} CatalogModel
 *
 * @typedef {{
 *   provider: string,
 *   displayName?: string,
 *   configured?: boolean,
 *   source?: string,
 *   models?: CatalogModel[],
 * }} CatalogProvider
 *
 * @typedef {{
 *   describeProviderSummary: (models: CatalogModel[]) => string,
 *   describeModelHealth: (health: ModelHealthState) => string,
 *   describeModelStatus: (model: CatalogModel) => string,
 *   healthDotClass: (health: ModelHealthState) => string,
 *   checkModelHealth: (provider: string) => Promise<void> | void,
 * }} ProviderListModelHealth
 *
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 * }} ConfigOpResponse
 *
 * @typedef {(
 *   op: string,
 *   params?: unknown,
 *   options?: unknown,
 * ) => Promise<unknown>} ModelsConfigCall
 *
 * @typedef {object} ProviderListDeps
 * @property {ProviderListModelHealth} modelHealth
 * @property {Map<string, boolean>} providerExpansionState
 * @property {() => Element | null | undefined} apiKeysContainer
 * @property {(value: unknown) => string} escapeSelectorValue
 * @property {ModelsConfigCall} call
 * @property {(() => Promise<void> | void) | null | undefined} [onModelConfigurationChanged]
 * @property {(options?: { preserveUi?: boolean }) => Promise<void> | void} loadApiKeysPanel
 * @property {(row: Element, provider: CatalogProvider) => void} openApiKeyEditor
 * @property {(provider: CatalogProvider) => Promise<void> | void} removeApiKey
 */

/**
 * @param {ProviderListDeps} deps
 */
export function createProviderList(deps) {
  /** @param {CatalogProvider} provider */
  function getProviderModels(provider) {
    return Array.isArray(provider.models) ? provider.models : [];
  }

  /** @param {CatalogProvider} p */
  function buildApiKeyRow(p) {
    const row = document.createElement("div");
    row.className = "api-key-row";
    row.dataset.provider = p.provider;

    const header = document.createElement("div");
    header.className = "api-key-row-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "api-provider-toggle";
    toggle.setAttribute(
      "aria-label",
      t("settings.apiKeys.toggleModels", { provider: p.displayName || p.provider }),
    );
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "▼";

    const info = document.createElement("div");
    info.className = "api-key-row-info";
    const name = document.createElement("div");
    name.className = "api-key-row-name";
    name.textContent = p.displayName || p.provider;
    info.appendChild(name);

    const actions = document.createElement("div");
    actions.className = "api-key-row-actions";
    const setBtn = document.createElement("button");
    setBtn.type = "button";
    setBtn.textContent = p.configured ? t("actions.update") : t("actions.setKey");
    setBtn.addEventListener("click", () => deps.openApiKeyEditor(row, p));

    const models = getProviderModels(p);
    const hasConfiguredModels = p.configured && models.length > 0;
    if (hasConfiguredModels) {
      const checkHealthBtn = document.createElement("button");
      checkHealthBtn.type = "button";
      checkHealthBtn.className = "api-model-check-visible";
      checkHealthBtn.textContent = t("settings.apiKeys.checkHealth");
      checkHealthBtn.disabled = !models.some((model) => model.visible === true && model.available);
      checkHealthBtn.addEventListener("click", () => deps.modelHealth.checkModelHealth(p.provider));
      actions.appendChild(checkHealthBtn);
    }
    actions.appendChild(setBtn);
    if (p.configured && p.source === "stored") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "danger";
      removeBtn.textContent = t("actions.remove");
      removeBtn.addEventListener("click", () => deps.removeApiKey(p));
      actions.appendChild(removeBtn);
    }

    const modelList = hasConfiguredModels ? buildModelList(p) : null;
    header.appendChild(toggle);
    header.appendChild(info);
    if (hasConfiguredModels) {
      const summary = document.createElement("div");
      summary.className = "api-key-row-summary";
      summary.textContent = deps.modelHealth.describeProviderSummary(models);
      header.appendChild(summary);
    }
    header.appendChild(actions);
    row.appendChild(header);
    if (modelList) {
      const isExpanded = deps.providerExpansionState.get(p.provider) ?? true;
      modelList.classList.toggle("collapsed", !isExpanded);
      toggle.setAttribute("aria-expanded", String(isExpanded));
      const toggleModelList = () => {
        modelList.classList.toggle("collapsed");
        const expanded = !modelList.classList.contains("collapsed");
        toggle.setAttribute("aria-expanded", String(expanded));
        deps.providerExpansionState.set(p.provider, expanded);
      };
      header.addEventListener("click", (event) => {
        const target = event.target;
        if (
          target &&
          "closest" in target &&
          typeof target.closest === "function" &&
          target.closest(".api-key-row-actions")
        ) {
          return;
        }
        toggleModelList();
      });
      info.classList.add("api-provider-title-toggle");
      info.tabIndex = 0;
      info.setAttribute("role", "button");
      info.setAttribute(
        "aria-label",
        t("settings.apiKeys.toggleModels", { provider: p.displayName || p.provider }),
      );
      info.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleModelList();
        }
      });
      row.appendChild(modelList);
    } else {
      toggle.hidden = true;
    }
    return row;
  }

  /** @param {CatalogProvider} p */
  function buildModelList(p) {
    const wrap = document.createElement("div");
    wrap.className = "api-model-list";

    const models = getProviderModels(p);
    if (models.length === 0) return null;

    const columnLabels = document.createElement("div");
    columnLabels.className = "api-model-list-heading";
    const statusColumn = document.createElement("span");
    const modelColumn = document.createElement("span");
    modelColumn.textContent = t("settings.apiKeys.model");

    const actions = document.createElement("div");
    actions.className = "api-model-list-heading-actions";
    const visibilityColumn = document.createElement("label");
    visibilityColumn.className = "api-model-select-all";
    const allModelsEnabled = models.every((model) => model.visible === true);
    const visibilityToggle = document.createElement("input");
    visibilityToggle.type = "checkbox";
    visibilityToggle.className = "api-model-select-all-toggle";
    visibilityToggle.checked = allModelsEnabled;
    visibilityToggle.setAttribute(
      "aria-label",
      t(allModelsEnabled ? "settings.apiKeys.deselectAll" : "settings.apiKeys.selectAll", {
        provider: p.displayName || p.provider,
      }),
    );
    visibilityToggle.addEventListener("change", () =>
      setProviderModelsVisibility(p.provider, visibilityToggle.checked),
    );
    const allModels = document.createElement("span");
    allModels.textContent = t("settings.apiKeys.allModels");
    visibilityColumn.append(visibilityToggle, allModels);
    columnLabels.append(statusColumn, modelColumn, actions, visibilityColumn);
    wrap.appendChild(columnLabels);

    for (const model of models) {
      wrap.appendChild(buildModelRow(model));
    }
    return wrap;
  }

  /** @param {string} provider */
  function getProviderModelRows(provider) {
    const container = deps.apiKeysContainer();
    if (!container) return [];
    return [
      ...container.querySelectorAll(
        `.api-model-row[data-provider="${deps.escapeSelectorValue(provider)}"]`,
      ),
    ];
  }

  /**
   * @param {string} provider
   * @param {boolean} visible
   */
  async function setProviderModelsVisibility(provider, visible) {
    const rows = getProviderModelRows(provider);
    const toggles = rows
      .map((row) => row.querySelector(".api-model-visibility-toggle"))
      .filter(/** @returns {el is Element} */ (el) => Boolean(el));
    const modelsToUpdate = rows.filter((row) => {
      const toggle = row.querySelector(".api-model-visibility-toggle");
      const checked =
        toggle && "checked" in toggle
          ? /** @type {{ checked: boolean }} */ (toggle).checked
          : false;
      return checked !== visible;
    });
    if (modelsToUpdate.length === 0) return;

    const container = deps.apiKeysContainer();
    const providerRow = container?.querySelector(
      `.api-key-row[data-provider="${deps.escapeSelectorValue(provider)}"]`,
    );
    const visibilityButton = providerRow?.querySelector(".api-model-select-all-toggle");
    if (visibilityButton && "disabled" in visibilityButton) {
      /** @type {{ disabled: boolean }} */ (visibilityButton).disabled = true;
    }
    for (const toggle of toggles) {
      if ("disabled" in toggle) /** @type {{ disabled: boolean }} */ (toggle).disabled = true;
    }
    for (const row of modelsToUpdate) {
      const modelId =
        "dataset" in row
          ? /** @type {{ dataset: DOMStringMap }} */ (row).dataset.modelId
          : undefined;
      const resp = await deps
        .call("set_model_visibility", {
          provider,
          modelId,
          visible,
        })
        .catch(() => null);
      const response = asConfigOpResponse(resp);
      if (!response?.ok) {
        if (visibilityButton && "disabled" in visibilityButton) {
          /** @type {{ disabled: boolean }} */ (visibilityButton).disabled = false;
        }
        for (const toggle of toggles) {
          if ("disabled" in toggle) /** @type {{ disabled: boolean }} */ (toggle).disabled = false;
        }
        return;
      }
    }
    await deps.onModelConfigurationChanged?.();
    await deps.loadApiKeysPanel({ preserveUi: true });
  }

  /** @param {CatalogModel} model */
  function buildModelRow(model) {
    const row = document.createElement("div");
    row.className = "api-model-row";
    row.dataset.provider = model.provider || "";
    row.dataset.modelId = model.id || "";
    row.dataset.available = String(model.available);

    const modelHealthState = model.health || { status: "unknown" };
    const healthDot = document.createElement("span");
    healthDot.className = `api-model-health-dot ${deps.modelHealth.healthDotClass(modelHealthState)}`;
    healthDot.title = deps.modelHealth.describeModelHealth(modelHealthState);

    const label = document.createElement("div");
    label.className = "api-model-label";
    const name = document.createElement("div");
    name.className = "api-model-name";
    name.textContent = model.name || model.id || "";
    const meta = document.createElement("div");
    meta.className = "api-model-health-status";
    meta.textContent = deps.modelHealth.describeModelStatus(model);
    label.appendChild(name);
    label.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "api-model-actions";

    const visibilityLabel = document.createElement("label");
    visibilityLabel.className = "api-model-visibility";
    const visibility = document.createElement("input");
    visibility.type = "checkbox";
    visibility.className = "api-model-visibility-toggle";
    visibility.setAttribute(
      "aria-label",
      t("settings.apiKeys.enableModel", { model: model.name || model.id || "" }),
    );
    visibility.checked = model.visible === true;
    visibility.addEventListener("change", async () => {
      visibility.disabled = true;
      const resp = await deps
        .call("set_model_visibility", {
          provider: model.provider,
          modelId: model.id,
          visible: visibility.checked,
        })
        .catch(() => null);
      const response = asConfigOpResponse(resp);
      if (response?.ok) {
        await deps.onModelConfigurationChanged?.();
        await deps.loadApiKeysPanel({ preserveUi: true });
      } else {
        visibility.checked = !visibility.checked;
        visibility.disabled = false;
      }
    });
    visibilityLabel.appendChild(visibility);
    actions.appendChild(visibilityLabel);

    row.appendChild(healthDot);
    row.appendChild(label);
    row.appendChild(actions);
    return row;
  }

  return { getProviderModels, buildApiKeyRow, buildModelList, getProviderModelRows };
}

/** @param {unknown} value */
function asConfigOpResponse(value) {
  if (!value || typeof value !== "object") return /** @type {ConfigOpResponse | null} */ (null);
  return /** @type {ConfigOpResponse} */ (value);
}
