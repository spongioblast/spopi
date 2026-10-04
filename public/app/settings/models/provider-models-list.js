// ABOUTME: The Models section of one provider: rows with picker switches, health, badges, and a "…" menu.
// ABOUTME: Pi decides which models can be switched on; this list only asks it to change visibility.

import { t } from "../../i18n/i18n.js";
import { showContextMenu } from "../../ui/context-menu.js";
import { createIcon } from "../../ui/icons.js";
import { formatContextTokens } from "../settings-custom-provider.js";
import { asConfigOpResponse } from "./config-op-response.js";
import { modelBadges } from "./model-draft.js";
import { HEALTH_CHECK_TIMEOUT_MS } from "./model-health.js";

/**
 * @typedef {import("./provider-editor.js").ProviderEditorDeps} ProviderEditorDeps
 * @typedef {import("./provider-editor.js").ModelsJsonProvider} ModelsJsonProvider
 * @typedef {import("./model-draft.js").ModelEntry} ModelsJsonModel
 * @typedef {import("./model-health.js").CatalogModel} CatalogModel
 *
 * @typedef {object} ProviderModelsListDeps
 * @property {ProviderEditorDeps} deps
 * @property {(providerName: string, index: number | null, options?: { runSetup?: boolean }) => void} openModel
 * @property {(providerName: string, index: number) => Promise<void>} deleteModel
 */

/**
 * @param {HTMLElement} main
 * @param {string} providerName
 * @param {ModelsJsonProvider} entry
 * @param {ProviderModelsListDeps} listDeps
 */
export function renderProviderModelsList(
  main,
  providerName,
  entry,
  { deps, openModel, deleteModel },
) {
  const { view } = deps;
  const models = entry.models || [];
  const section = document.createElement("div");
  section.className = "models-config-models-section";
  const header = document.createElement("div");
  header.className = "models-config-models-header";
  const title = document.createElement("h3");
  title.textContent = t("models.models");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "models-model-add ui-button ui-button--ghost ui-button--sm";
  addBtn.textContent = t("models.addModel");
  addBtn.addEventListener("click", () => openModel(providerName, null));
  header.append(title, addBtn);
  section.appendChild(header);
  if (models.length === 0) {
    const empty = document.createElement("p");
    empty.className = "models-config-models-empty";
    empty.textContent = t("models.noModels");
    section.appendChild(empty);
    main.appendChild(section);
    return;
  }
  const catalog = new Map(
    (deps.catalogModels?.(providerName) ?? []).map((model) => [model.id, model]),
  );
  renderModelsHeaderStatus(deps, header, providerName, models, catalog);
  const list = document.createElement("ul");
  list.className = "models-config-models-list";
  const highlight = view.highlight?.provider === providerName ? view.highlight.modelId : "";
  view.highlight = null;
  for (const [index, model] of models.entries()) {
    const row = document.createElement("li");
    row.className = "models-config-models-row";
    row.dataset.modelId = model.id || "";
    if (highlight && model.id === highlight) row.classList.add("is-highlighted");
    const enabled = modelEnabledSwitch(deps, providerName, model, catalog.get(model.id));
    const label = document.createElement("span");
    label.className = "models-config-model-label";
    label.textContent = model.id || t("models.unnamedModel");
    const health = catalog.get(model.id)?.health;
    if (health?.status === "healthy" || health?.status === "unhealthy") {
      const dot = document.createElement("span");
      dot.className = `api-model-health-dot ${deps.modelHealth?.healthDotClass(health) ?? ""}`;
      dot.title = deps.modelHealth?.describeModelHealth(health) ?? "";
      label.prepend(dot);
    }
    const meta = document.createElement("span");
    meta.className = "models-config-model-meta";
    const badges = modelBadges(model, entry);
    if (badges.contextWindow) {
      const context = document.createElement("span");
      context.className = "models-config-model-context";
      context.textContent = formatContextTokens(badges.contextWindow);
      meta.appendChild(context);
    }
    for (const [on, key, className] of /** @type {Array<[boolean, string, string]>} */ ([
      [badges.thinking, "models.badgeThinking", "models-badge-thinking"],
      [badges.images, "models.badgeImages", "models-badge-images"],
    ])) {
      if (!on) continue;
      const badge = document.createElement("span");
      badge.className = `ui-badge models-config-badge ${className}`;
      badge.textContent = t(key);
      meta.appendChild(badge);
    }
    const actions = document.createElement("div");
    actions.className = "models-config-models-row-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ui-button ui-button--sm models-model-edit";
    editBtn.textContent = t("models.edit");
    editBtn.addEventListener("click", () => openModel(providerName, index));
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "ui-button ui-button--ghost ui-button--sm models-model-more";
    moreBtn.title = t("models.moreActions");
    moreBtn.setAttribute("aria-label", t("models.moreActions"));
    moreBtn.setAttribute("aria-haspopup", "menu");
    const moreIcon = createIcon("ellipsis", { size: 14 });
    if (moreIcon) moreBtn.appendChild(moreIcon);
    else moreBtn.textContent = "…";
    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = moreBtn.getBoundingClientRect();
      showContextMenu({
        event: { clientX: rect.left, clientY: rect.bottom + 4 },
        items: [
          {
            label: t("models.setup.button"),
            disabled: !model.id,
            action: () => openModel(providerName, index, { runSetup: true }),
          },
          { separator: true },
          { label: t("models.delete"), action: () => void deleteModel(providerName, index) },
        ],
      });
    });
    actions.append(editBtn, moreBtn);
    row.append(enabled, label, meta, actions);
    list.appendChild(row);
  }
  section.appendChild(list);
  main.appendChild(section);
  const highlighted = list.querySelector(".is-highlighted");
  if (highlighted && "scrollIntoView" in highlighted) {
    requestAnimationFrame(() => highlighted.scrollIntoView({ block: "nearest" }));
  }
}

/**
 * The switch that puts a model in the composer's model picker. Pi decides
 * availability; a model Pi has not loaded (no key yet, server unreadable)
 * cannot be switched on.
 * @param {ProviderEditorDeps} deps
 * @param {string} providerName
 * @param {ModelsJsonModel} model
 * @param {CatalogModel | undefined} catalogModel
 */
function modelEnabledSwitch(deps, providerName, model, catalogModel) {
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "ui-toggle api-model-visibility-toggle models-model-enabled";
  toggle.checked = catalogModel?.visible === true;
  toggle.disabled = !model.id || catalogModel?.available !== true;
  toggle.setAttribute("aria-label", t("settings.apiKeys.enableModel", { model: model.id || "" }));
  toggle.title = toggle.disabled ? t("models.enableUnavailable") : t("models.enableHint");
  toggle.addEventListener("change", () => {
    void setModelsEnabled(deps, providerName, [model.id || ""], toggle.checked, [toggle]);
  });
  return toggle;
}

/**
 * "3 of 10 in the picker", an All switch, and Check health for the listed models.
 * @param {ProviderEditorDeps} deps
 * @param {HTMLElement} header
 * @param {string} providerName
 * @param {ModelsJsonModel[]} models
 * @param {Map<string | undefined, CatalogModel>} catalog
 */
function renderModelsHeaderStatus(deps, header, providerName, models, catalog) {
  const switchable = models.filter((model) => catalog.get(model.id)?.available === true);
  const enabled = models.filter((model) => catalog.get(model.id)?.visible === true);
  const summary = document.createElement("span");
  summary.className = "models-config-models-summary";
  summary.textContent = t("models.enabledCount", {
    enabled: enabled.length,
    total: models.length,
  });
  header.insertBefore(summary, header.lastChild);
  if (switchable.length === 0) return;

  const allLabel = document.createElement("label");
  allLabel.className = "api-model-select-all models-model-enable-all";
  const all = document.createElement("input");
  all.type = "checkbox";
  all.className = "ui-toggle api-model-select-all-toggle";
  all.checked = switchable.every((model) => catalog.get(model.id)?.visible === true);
  all.setAttribute("aria-label", t("models.enableAll", { provider: providerName }));
  all.addEventListener("change", () => {
    const ids = switchable
      .filter((model) => (catalog.get(model.id)?.visible === true) !== all.checked)
      .map((model) => model.id || "");
    void setModelsEnabled(deps, providerName, ids, all.checked, [all]);
  });
  allLabel.append(all, document.createTextNode(t("settings.apiKeys.allModels")));

  const check = document.createElement("button");
  check.type = "button";
  check.className = "ui-button ui-button--sm models-model-check-health";
  check.textContent = t("settings.apiKeys.checkHealth");
  check.disabled = enabled.length === 0;
  check.addEventListener("click", () => {
    void (async () => {
      check.disabled = true;
      check.textContent = t("settings.apiKeys.checkingHealthEllipsis");
      await deps
        .call(
          "check_model_health",
          { provider: providerName },
          { timeoutMs: HEALTH_CHECK_TIMEOUT_MS },
        )
        .catch(() => null);
      await deps.loadApiKeysPanel({ preserveUi: true });
    })();
  });
  header.append(allLabel, check);
}

/**
 * @param {ProviderEditorDeps} deps
 * @param {string} providerName
 * @param {string[]} modelIds
 * @param {boolean} visible
 * @param {HTMLInputElement[]} controls
 */
async function setModelsEnabled(deps, providerName, modelIds, visible, controls) {
  for (const control of controls) control.disabled = true;
  for (const modelId of modelIds.filter(Boolean)) {
    const response = asConfigOpResponse(
      await deps
        .call("set_model_visibility", { provider: providerName, modelId, visible })
        .catch(() => null),
    );
    if (!response?.ok) break;
  }
  await deps.onModelConfigurationChanged?.();
  await deps.loadApiKeysPanel({ preserveUi: true });
}
