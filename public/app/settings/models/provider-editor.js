// ABOUTME: Edits one models.json provider: its fields, key, models, and the model form flow.
// ABOUTME: Provider fields are a draft until Save provider; a model saves on its own and returns here.

import { t } from "../../i18n/i18n.js";
import { confirmDialog } from "../../ui/dialog.js";
import { enhanceSelect } from "../../ui/select-menu.js";
import { formatContextTokens } from "../settings-custom-provider.js";
import {
  clearSettingsSaveMessage,
  setSettingsSaveButtonSaving,
  showSettingsSaveError,
  showSettingsSaveSuccess,
} from "../settings-save-status.js";
import { cloneEntry, effectiveThinkingLevel, modelBadges } from "./model-draft.js";
import { isModelDraftDirty, modelDraftSnapshot, renderModelForm } from "./model-form.js";
import { HEALTH_CHECK_TIMEOUT_MS } from "./model-health.js";
import { createProviderKeyRow } from "./provider-key-row.js";

/**
 * @typedef {import("./model-draft.js").ModelEntry} ModelsJsonModel
 * @typedef {import("./model-form.js").ModelDraft} ModelDraft
 * @typedef {import("./model-health.js").CatalogModel} CatalogModel
 *
 * @typedef {{
 *   baseUrl?: string,
 *   apiKey?: string,
 *   api?: string,
 *   compat?: Record<string, unknown>,
 *   models?: ModelsJsonModel[],
 *   [key: string]: unknown,
 * }} ModelsJsonProvider
 *
 * @typedef {{
 *   providers: Record<string, ModelsJsonProvider>,
 *   [key: string]: unknown,
 * }} ModelsJsonConfig
 *
 * @typedef {{
 *   type: "auth" | "provider" | "model" | "model-new",
 *   provider: string,
 *   index?: number,
 * }} ModelsConfigSelection
 *
 * @typedef {{ provider: string, baseUrl: string, api: string, original: string }} ProviderDraft
 * @typedef {{ provider: string, server?: string, modelIds: string[] }} SetupOffer
 *
 * @typedef {{
 *   selected: ModelsConfigSelection | null,
 *   providerDraft: ProviderDraft | null,
 *   modelDraft: ModelDraft | null,
 *   highlight: { provider: string, modelId: string } | null,
 *   offerSetup: SetupOffer | null,
 * }} ModelsViewState
 *
 * @typedef {{ providers?: string[], renamed?: { from: string, to: string } }} ModelConfigChange
 *
 * @typedef {{
 *   provider: string,
 *   displayName?: string,
 * }} ApiKeyProvider
 *
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: Record<string, unknown>,
 * }} ConfigOpResponse
 *
 * @typedef {(
 *   op: string,
 *   params?: unknown,
 *   options?: unknown,
 * ) => Promise<unknown>} ModelsConfigCall
 *
 * @typedef {{
 *   textContent: string,
 *   classList: { add: (token: string) => void, remove: (token: string) => void },
 *   dataset: DOMStringMap,
 * }} SaveMessageEl
 *
 * @typedef {{
 *   disabled: boolean,
 *   textContent: string,
 * }} SaveButtonEl
 *
 * @typedef {object} ProviderEditorDeps
 * @property {ModelsViewState} view
 * @property {() => void} renderModelsConfigLayout
 * @property {() => Promise<void>} reloadModelsConfig
 * @property {() => HTMLTextAreaElement | Element | null | undefined} inlineModelsTextarea
 * @property {() => HTMLButtonElement | Element | null | undefined} inlineModelsSave
 * @property {() => Element | null | undefined} inlineModelsError
 * @property {((change?: ModelConfigChange) => Promise<void> | void) | null | undefined} [onModelConfigurationChanged]
 * @property {ModelsConfigCall} call
 * @property {(options?: { preserveUi?: boolean }) => Promise<void> | void} loadApiKeysPanel
 * @property {(provider: string) => CatalogModel[]} [catalogModels]
 * @property {{
 *   describeModelHealth: (health: CatalogModel["health"]) => string,
 *   healthDotClass: (health: CatalogModel["health"]) => string,
 * }} [modelHealth]
 */

const API_OPTIONS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

/**
 * Providers whose entry differs between two models.json documents, removed ones included.
 * @param {{ providers?: Record<string, unknown> } | null | undefined} before
 * @param {{ providers?: Record<string, unknown> } | null | undefined} after
 */
export function changedProviders(before, after) {
  const a = before?.providers || {};
  const b = after?.providers || {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (id) => JSON.stringify(a[id]) !== JSON.stringify(b[id]),
  );
}

/**
 * @param {ProviderEditorDeps} deps
 */
export function createProviderEditor(deps) {
  const { view } = deps;

  /** @returns {ModelsJsonConfig | null} */
  function readBase() {
    const textarea = deps.inlineModelsTextarea();
    if (!textarea || !("value" in textarea)) return null;
    try {
      const parsed = JSON.parse(/** @type {{ value: string }} */ (textarea).value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (!parsed.providers || typeof parsed.providers !== "object") parsed.providers = {};
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Writes the whole document, then runs `afterWrite` before telling the app, so a saved
   * thinking level is on disk when the open session re-reads the model.
   * @param {ModelsJsonConfig} next
   * @param {{ status?: HTMLElement | null, button?: HTMLButtonElement | null, afterWrite?: () => Promise<void> }} [options]
   */
  async function persistConfig(next, { status, button, afterWrite } = {}) {
    const before = readBase();
    const content = JSON.stringify(next, null, 2);
    if (button) setSettingsSaveButtonSaving(asSaveButton(button), true);
    try {
      const response = asConfigOpResponse(await deps.call("write_models_config", { content }));
      if (!response?.ok) throw new Error(response?.error || t("models.saveFailed"));
      const textarea = deps.inlineModelsTextarea();
      if (textarea && "value" in textarea) {
        /** @type {{ value: string }} */ (textarea).value = content;
      }
      await afterWrite?.();
      await deps.onModelConfigurationChanged?.({ providers: changedProviders(before, next) });
      return true;
    } catch (error) {
      if (status) {
        status.textContent = errorMessage(error) || t("models.saveFailed");
        status.hidden = false;
      }
      return false;
    } finally {
      if (button) setSettingsSaveButtonSaving(asSaveButton(button), false);
    }
  }

  /** @param {string} providerName */
  function providerDraftFor(providerName, /** @type {ModelsJsonProvider} */ entry) {
    if (view.providerDraft?.provider === providerName) return view.providerDraft;
    const fields = { baseUrl: entry.baseUrl || "", api: entry.api || "openai-completions" };
    view.providerDraft = {
      provider: providerName,
      ...fields,
      original: JSON.stringify(fields),
    };
    return view.providerDraft;
  }

  /** @param {ProviderDraft | null} draft */
  function isProviderDirty(draft) {
    return Boolean(
      draft && JSON.stringify({ baseUrl: draft.baseUrl, api: draft.api }) !== draft.original,
    );
  }

  function hasUnsavedChanges() {
    return Boolean(
      (view.modelDraft && isModelDraftDirty(view.modelDraft)) ||
        isProviderDirty(view.providerDraft),
    );
  }

  /**
   * Resolves true when nothing is unsaved, or the user agreed to discard it.
   * @param {{ keepProvider?: boolean }} [options]
   */
  async function confirmLeave({ keepProvider = false } = {}) {
    const modelDirty = view.modelDraft && isModelDraftDirty(view.modelDraft);
    const providerDirty = !keepProvider && isProviderDirty(view.providerDraft);
    if (!modelDirty && !providerDirty) {
      view.modelDraft = null;
      if (!keepProvider) view.providerDraft = null;
      return true;
    }
    const ok = await confirmDialog({
      title: t("models.unsavedTitle"),
      message: modelDirty ? t("models.discardModel") : t("models.discardProvider"),
      confirmLabel: t("models.discard"),
      danger: true,
    });
    if (!ok) return false;
    view.modelDraft = null;
    if (!keepProvider) view.providerDraft = null;
    return true;
  }

  /**
   * @param {string} providerName
   * @param {number | null} index
   * @param {{ runSetup?: boolean }} [options]
   */
  function openModel(providerName, index, { runSetup = false } = {}) {
    const base = readBase();
    const entry = base?.providers[providerName];
    if (!entry) return;
    const source = index === null ? { id: "" } : entry.models?.[index];
    if (!source) return;
    const model = cloneEntry(source);
    if (index === null) delete model.id;
    /** @type {ModelDraft} */
    const draft = {
      provider: providerName,
      index,
      model,
      level: null,
      original: "",
      runSetup,
      server: view.offerSetup?.provider === providerName ? view.offerSetup.server : undefined,
    };
    draft.original = modelDraftSnapshot(draft);
    view.modelDraft = draft;
    view.selected =
      index === null
        ? { type: "model-new", provider: providerName }
        : { type: "model", provider: providerName, index };
    deps.renderModelsConfigLayout();
    const modelId = String(model.id || "");
    if (!modelId || !model.reasoning) return;
    void deps
      .call("get_model_thinking_level", { provider: providerName, modelId })
      .then((response) => {
        const level = /** @type {{ data?: { level?: string | null } }} */ (response)?.data?.level;
        if (view.modelDraft !== draft || !level || draft.level) return;
        draft.level = level;
        draft.original = modelDraftSnapshot(draft);
        deps.renderModelsConfigLayout();
      })
      .catch(() => {});
  }

  /**
   * @param {string} providerName
   * @param {string} [modelId]
   * @param {{ saved?: boolean }} [options]
   */
  function returnToProvider(providerName, modelId, { saved = false } = {}) {
    view.modelDraft = null;
    view.selected = { type: "provider", provider: providerName };
    const highlight = modelId ? { provider: providerName, modelId } : null;
    view.highlight = highlight;
    deps.renderModelsConfigLayout();
    if (!saved) return;
    // The reload renders again, now with the switch state for a new model.
    view.highlight = highlight;
    void deps.loadApiKeysPanel({ preserveUi: true });
  }

  /**
   * @param {string} provider
   * @param {string} modelId
   * @param {string | null} level
   */
  async function saveLevel(provider, modelId, level) {
    await deps
      .call("set_model_thinking_level", { provider, modelId, level })
      .catch(() => undefined);
  }

  /**
   * @param {ModelDraft} draft
   * @param {HTMLButtonElement} button
   * @param {HTMLElement} error
   */
  async function saveModel(draft, button, error) {
    error.hidden = true;
    const base = readBase();
    const entry = base?.providers[draft.provider];
    if (!base || !entry) return;
    const modelId = String(draft.model.id || "").trim();
    if (!modelId) {
      error.textContent = t("models.modelIdRequired");
      error.hidden = false;
      return;
    }
    entry.models ||= [];
    const duplicate = entry.models.findIndex(
      (model, index) => model.id === modelId && index !== draft.index,
    );
    if (duplicate >= 0) {
      error.textContent = t("models.modelIdTaken", { id: modelId });
      error.hidden = false;
      return;
    }
    const previousId = draft.index === null ? "" : String(entry.models[draft.index]?.id || "");
    const saved = { ...cloneEntry(draft.model), id: modelId };
    if (draft.index === null) entry.models.push(saved);
    else entry.models[draft.index] = saved;
    const ok = await persistConfig(base, {
      status: error,
      button,
      afterWrite: async () => {
        if (previousId && previousId !== modelId) await saveLevel(draft.provider, previousId, null);
        await saveLevel(
          draft.provider,
          modelId,
          saved.reasoning ? effectiveThinkingLevel(saved, draft.level) : null,
        );
      },
    });
    if (ok) returnToProvider(draft.provider, modelId, { saved: true });
  }

  /** @param {string} providerName @param {number} index */
  async function deleteModel(providerName, index) {
    const base = readBase();
    const entry = base?.providers[providerName];
    const model = entry?.models?.[index];
    if (!base || !entry || !model) return;
    const label = model.id || t("models.unnamedModel");
    const ok = await confirmDialog({
      message: t("models.deleteModel", { name: label }),
      confirmLabel: t("models.delete"),
      danger: true,
    });
    if (!ok) return;
    entry.models?.splice(index, 1);
    const saved = await persistConfig(base, {
      afterWrite: async () => {
        if (model.id) await saveLevel(providerName, model.id, null);
      },
    });
    if (saved) returnToProvider(providerName, undefined, { saved: true });
  }

  /**
   * @param {HTMLElement} main
   * @param {ModelsConfigSelection} selection
   */
  function renderModelView(main, selection) {
    const base = readBase();
    const entry = base?.providers[selection.provider];
    if (!entry) return;
    const index = selection.type === "model" ? (selection.index ?? null) : null;
    let draft = view.modelDraft;
    if (!draft || draft.provider !== selection.provider || draft.index !== index) {
      openModel(selection.provider, index);
      return;
    }
    renderModelForm(main, {
      draft,
      providerEntry: entry,
      call: deps.call,
      onBack: () => {
        void (async () => {
          if (await confirmLeave({ keepProvider: true })) returnToProvider(selection.provider);
        })();
      },
      onSave: (button, error) => {
        draft = view.modelDraft;
        if (draft) void saveModel(draft, button, error);
      },
      onDelete: index === null ? undefined : () => void deleteModel(selection.provider, index),
    });
  }

  /**
   * @param {HTMLElement} main
   * @param {string} providerName
   */
  function renderSetupOffer(main, providerName) {
    const offer = view.offerSetup;
    if (!offer || offer.provider !== providerName) return;
    const models = readBase()?.providers[providerName]?.models || [];
    const ids = offer.modelIds.filter((id) => models.some((model) => model.id === id));
    if (ids.length === 0) return;
    const banner = document.createElement("div");
    banner.className = "models-setup-offer";
    banner.setAttribute("role", "status");
    const text = document.createElement("p");
    text.textContent = t("models.setup.offer", { count: ids.length });
    const actions = document.createElement("div");
    actions.className = "models-setup-offer-actions";
    /** @type {HTMLSelectElement | null} */
    let picker = null;
    if (ids.length > 1) {
      picker = document.createElement("select");
      picker.className = "ui-select models-setup-offer-model";
      picker.setAttribute("aria-label", t("models.setup.pickModel"));
      for (const id of ids) picker.appendChild(new Option(id, id));
      actions.appendChild(picker);
    }
    const run = document.createElement("button");
    run.type = "button";
    run.className = "ui-button ui-button--primary ui-button--sm models-setup-offer-run";
    run.textContent =
      ids.length > 1 ? t("models.setup.button") : t("models.setup.buttonFor", { model: ids[0] });
    run.addEventListener("click", () => {
      const id = picker ? picker.value : ids[0];
      const index = models.findIndex((model) => model.id === id);
      if (index >= 0) openModel(providerName, index, { runSetup: true });
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "ui-icon-button ui-icon-button--ghost ui-icon-button--sm";
    dismiss.setAttribute("aria-label", t("models.setup.dismiss"));
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
      view.offerSetup = null;
      banner.remove();
    });
    actions.append(run, dismiss);
    banner.append(text, actions);
    main.appendChild(banner);
    const pickerEl = picker;
    if (pickerEl) queueMicrotask(() => pickerEl.isConnected && enhanceSelect(pickerEl));
  }

  /**
   * @param {HTMLElement} main
   * @param {string} providerName
   */
  function renderProviderView(main, providerName) {
    const base = readBase();
    const entry = base?.providers[providerName];
    if (!base || !entry) return;
    const draft = providerDraftFor(providerName, entry);

    const header = document.createElement("div");
    header.className = "models-config-detail-header";
    const heading = document.createElement("div");
    heading.className = "models-config-heading";
    const eyebrow = document.createElement("span");
    eyebrow.className = "models-config-eyebrow";
    eyebrow.textContent = t("models.provider");
    const title = document.createElement("h3");
    title.className = "models-config-provider-title";
    title.textContent = providerName;
    const dirtyMark = document.createElement("span");
    dirtyMark.className = "models-config-dirty";
    dirtyMark.textContent = t("models.unsaved");
    heading.append(eyebrow, title, dirtyMark);
    const headerActions = document.createElement("div");
    headerActions.className = "models-config-detail-actions";
    const saveProvider = document.createElement("button");
    saveProvider.type = "button";
    saveProvider.className = "ui-button ui-button--primary ui-button--sm models-provider-save";
    saveProvider.textContent = t("models.saveProvider");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ui-button ui-button--danger ui-button--sm models-provider-delete";
    remove.textContent = t("models.delete");
    headerActions.append(saveProvider, remove);
    header.append(heading, headerActions);
    const status = document.createElement("p");
    status.className = "models-config-form-error models-provider-status";
    status.hidden = true;

    const refreshDirty = () => {
      const dirty = isProviderDirty(draft);
      dirtyMark.hidden = !dirty;
      saveProvider.disabled = !dirty;
      header.classList.toggle("is-dirty", dirty);
    };

    saveProvider.addEventListener("click", () => {
      void (async () => {
        const next = readBase();
        const target = next?.providers[providerName];
        if (!next || !target) return;
        if (draft.baseUrl.trim()) target.baseUrl = draft.baseUrl.trim();
        else delete target.baseUrl;
        target.api = draft.api;
        status.hidden = true;
        const ok = await persistConfig(next, { status, button: saveProvider });
        if (!ok) return;
        view.providerDraft = null;
        deps.renderModelsConfigLayout();
        void deps.loadApiKeysPanel({ preserveUi: true });
      })();
    });
    remove.addEventListener("click", () => {
      void (async () => {
        const ok = await confirmDialog({
          message: t("models.deleteProvider", { name: providerName }),
          confirmLabel: t("models.delete"),
          danger: true,
        });
        if (!ok) return;
        const next = readBase();
        if (!next) return;
        delete next.providers[providerName];
        const saved = await persistConfig(next, { status });
        if (!saved) return;
        view.providerDraft = null;
        view.selected = null;
        deps.renderModelsConfigLayout();
        await deps.loadApiKeysPanel({ preserveUi: true });
      })();
    });

    const form = document.createElement("div");
    form.className = "models-config-form";

    const nameRow = document.createElement("div");
    nameRow.className = "models-provider-rename";
    const name = createInput(providerName, t("models.providerIdPlaceholder"));
    name.classList.add("models-provider-name");
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "ui-button ui-button--secondary ui-button--sm models-provider-rename-button";
    rename.textContent = t("models.rename");
    rename.disabled = true;
    name.addEventListener("input", () => {
      rename.disabled = !name.value.trim() || name.value.trim() === providerName;
    });
    rename.addEventListener(
      "click",
      () => void renameProvider(providerName, name.value.trim(), status),
    );
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !rename.disabled) {
        event.preventDefault();
        rename.click();
      }
    });
    nameRow.append(name, rename);

    const baseUrl = createInput(draft.baseUrl, "https://api.example.com/v1");
    baseUrl.classList.add("models-provider-base-url");
    baseUrl.addEventListener("input", () => {
      draft.baseUrl = baseUrl.value;
      refreshDirty();
    });
    const api = document.createElement("select");
    api.className = "ui-select models-provider-api";
    for (const value of API_OPTIONS) api.appendChild(new Option(value, value));
    if (!API_OPTIONS.includes(draft.api)) api.appendChild(new Option(draft.api, draft.api));
    api.value = draft.api;
    api.addEventListener("change", () => {
      draft.api = api.value;
      refreshDirty();
    });

    const keyRow = createProviderKeyRow({
      call: deps.call,
      provider: providerName,
      onChanged: async () => {
        await deps.reloadModelsConfig();
        await deps.onModelConfigurationChanged?.();
      },
    });

    form.append(
      createField(t("models.providerId"), nameRow, t("models.providerIdHint")),
      createField(t("models.baseUrl"), baseUrl),
      keyRow.element,
      createField(t("models.api"), api),
    );
    main.append(header, status);
    renderSetupOffer(main, providerName);
    main.appendChild(form);
    refreshDirty();
    queueMicrotask(() => {
      if (api.isConnected) enhanceSelect(api);
    });
    renderModelsList(main, providerName, entry);
  }

  /**
   * @param {string} from
   * @param {string} to
   * @param {HTMLElement} status
   */
  async function renameProvider(from, to, status) {
    status.hidden = true;
    if (isProviderDirty(view.providerDraft)) {
      status.textContent = t("models.renameSaveFirst");
      status.hidden = false;
      return;
    }
    const response = asConfigOpResponse(
      await deps.call("rename_custom_provider", { from, to }).catch((error) => ({
        ok: false,
        error: errorMessage(error),
      })),
    );
    if (!response?.ok) {
      status.textContent = response?.error || t("models.renameFailed");
      status.hidden = false;
      return;
    }
    view.providerDraft = null;
    view.selected = { type: "provider", provider: to };
    if (view.offerSetup?.provider === from) view.offerSetup = { ...view.offerSetup, provider: to };
    await deps.reloadModelsConfig();
    await deps.onModelConfigurationChanged?.({ providers: [from, to], renamed: { from, to } });
    void deps.loadApiKeysPanel({ preserveUi: true });
  }

  /**
   * @param {HTMLElement} main
   * @param {string} providerName
   * @param {ModelsJsonProvider} entry
   */
  function renderModelsList(main, providerName, entry) {
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
    renderModelsHeaderStatus(header, providerName, models, catalog);
    const list = document.createElement("ul");
    list.className = "models-config-models-list";
    const highlight = view.highlight?.provider === providerName ? view.highlight.modelId : "";
    view.highlight = null;
    for (const [index, model] of models.entries()) {
      const row = document.createElement("li");
      row.className = "models-config-models-row";
      row.dataset.modelId = model.id || "";
      if (highlight && model.id === highlight) row.classList.add("is-highlighted");
      const enabled = modelEnabledSwitch(providerName, model, catalog.get(model.id));
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
        badge.className = `models-config-badge ${className}`;
        badge.textContent = t(key);
        meta.appendChild(badge);
      }
      const actions = document.createElement("div");
      actions.className = "models-config-models-row-actions";
      const setupBtn = document.createElement("button");
      setupBtn.type = "button";
      setupBtn.className = "ui-button ui-button--sm models-model-setup-row";
      setupBtn.textContent = t("models.setup.short");
      setupBtn.title = t("models.setup.hint");
      setupBtn.disabled = !model.id;
      setupBtn.addEventListener("click", () => openModel(providerName, index, { runSetup: true }));
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ui-button ui-button--sm models-model-edit";
      editBtn.textContent = t("models.edit");
      editBtn.addEventListener("click", () => openModel(providerName, index));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ui-button ui-button--danger ui-button--sm models-model-remove";
      deleteBtn.textContent = t("models.delete");
      deleteBtn.addEventListener("click", () => void deleteModel(providerName, index));
      actions.append(setupBtn, editBtn, deleteBtn);
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
   * @param {string} providerName
   * @param {ModelsJsonModel} model
   * @param {CatalogModel | undefined} catalogModel
   */
  function modelEnabledSwitch(providerName, model, catalogModel) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "api-model-visibility-toggle models-model-enabled";
    toggle.checked = catalogModel?.visible === true;
    toggle.disabled = !model.id || catalogModel?.available !== true;
    toggle.setAttribute("aria-label", t("settings.apiKeys.enableModel", { model: model.id || "" }));
    toggle.title = toggle.disabled ? t("models.enableUnavailable") : t("models.enableHint");
    toggle.addEventListener("change", () => {
      void setModelsEnabled(providerName, [model.id || ""], toggle.checked, [toggle]);
    });
    return toggle;
  }

  /**
   * "3 of 10 in the picker", an All switch, and Check health for the listed models.
   * @param {HTMLElement} header
   * @param {string} providerName
   * @param {ModelsJsonModel[]} models
   * @param {Map<string | undefined, CatalogModel>} catalog
   */
  function renderModelsHeaderStatus(header, providerName, models, catalog) {
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
    all.className = "api-model-select-all-toggle";
    all.checked = switchable.every((model) => catalog.get(model.id)?.visible === true);
    all.setAttribute("aria-label", t("models.enableAll", { provider: providerName }));
    all.addEventListener("change", () => {
      const ids = switchable
        .filter((model) => (catalog.get(model.id)?.visible === true) !== all.checked)
        .map((model) => model.id || "");
      void setModelsEnabled(providerName, ids, all.checked, [all]);
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
   * @param {string} providerName
   * @param {string[]} modelIds
   * @param {boolean} visible
   * @param {HTMLInputElement[]} controls
   */
  async function setModelsEnabled(providerName, modelIds, visible, controls) {
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

  /**
   * The Advanced JSON dialog's Save: writes the textarea as it is.
   * @returns {Promise<boolean>}
   */
  async function persistInlineModelsConfig() {
    const textarea = deps.inlineModelsTextarea();
    if (!textarea || !("value" in textarea)) return false;
    const saveButton = asSaveButton(deps.inlineModelsSave());
    const status = asSaveMessage(deps.inlineModelsError());
    clearSettingsSaveMessage(status);
    const content = /** @type {{ value: string }} */ (textarea).value;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      showSettingsSaveError(status, t("models.invalidJson", { detail: errorMessage(e) }));
      return false;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      showSettingsSaveError(status, t("models.notAnObject"));
      return false;
    }
    const record = /** @type {Record<string, unknown>} */ (parsed);
    if (
      "providers" in record &&
      (typeof record.providers !== "object" ||
        record.providers === null ||
        Array.isArray(record.providers))
    ) {
      showSettingsSaveError(status, t("models.providersNotObject"));
      return false;
    }
    setSettingsSaveButtonSaving(saveButton, true);
    try {
      const before = await readSaved();
      const data = asConfigOpResponse(await deps.call("write_models_config", { content }));
      if (!data?.ok) throw new Error(data?.error || t("models.saveFailed"));
      showSettingsSaveSuccess(status);
      view.providerDraft = null;
      view.modelDraft = null;
      await deps.onModelConfigurationChanged?.({
        providers: changedProviders(before, /** @type {ModelsJsonConfig} */ (record)),
      });
      return true;
    } catch (e) {
      showSettingsSaveError(status, errorMessage(e) || String(e));
      return false;
    } finally {
      setSettingsSaveButtonSaving(saveButton, false);
    }
  }

  /** The file as saved, to tell which providers the JSON editor changed. */
  async function readSaved() {
    try {
      const response = asConfigOpResponse(await deps.call("read_models_config"));
      return JSON.parse(String(response?.data?.content ?? "{}"));
    } catch {
      return null;
    }
  }

  /**
   * @param {Element} row
   * @param {ApiKeyProvider} provider
   */
  function openApiKeyEditor(row, provider) {
    const panel = document.createElement("div");
    panel.className = "api-key-editor";
    const title = document.createElement("div");
    title.className = "api-key-row-name";
    title.textContent = t("settings.apiKeys.editorTitle", {
      provider: provider.displayName || provider.provider,
    });
    panel.appendChild(title);
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = t("settings.apiKeys.pastePlaceholder");
    panel.appendChild(input);
    const err = document.createElement("div");
    err.className = "api-key-editor-error";
    err.style.display = "none";
    panel.appendChild(err);
    const actions = document.createElement("div");
    actions.className = "api-key-editor-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ui-button ui-button--secondary config-editor-cancel";
    cancelBtn.textContent = t("actions.cancel");
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-button ui-button--primary";
    saveBtn.textContent = t("actions.save");
    actions.append(cancelBtn, saveBtn);
    panel.appendChild(actions);
    row.replaceWith(panel);
    requestAnimationFrame(() => input.focus());
    const cancel = () => {
      panel.replaceWith(row);
    };
    cancelBtn.addEventListener("click", cancel);
    const save = async () => {
      const key = input.value.trim();
      if (!key) {
        err.textContent = t("settings.apiKeys.keyCannotBeEmpty");
        err.style.display = "";
        return;
      }
      saveBtn.disabled = true;
      try {
        const resp = await deps
          .call("set_api_key", { provider: provider.provider, apiKey: key })
          .catch((/** @type {unknown} */ error) => ({
            ok: false,
            error: errorMessage(error),
          }));
        const response = asConfigOpResponse(resp);
        if (response?.ok) {
          await deps.onModelConfigurationChanged?.();
          await deps.loadApiKeysPanel();
        } else {
          err.textContent = response?.error || t("settings.apiKeys.saveFailed");
          err.style.display = "";
          saveBtn.disabled = false;
        }
      } catch (error) {
        err.textContent = errorMessage(error) || t("settings.apiKeys.saveFailed");
        err.style.display = "";
        saveBtn.disabled = false;
      }
    };
    saveBtn.addEventListener("click", () => {
      save();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
  }

  /** @param {ApiKeyProvider} provider */
  async function removeApiKey(provider) {
    const ok = await confirmDialog({
      message: t("settings.apiKeys.removeConfirm", {
        provider: provider.displayName || provider.provider,
      }),
    });
    if (!ok) return;
    const resp = await deps
      .call("remove_api_key", { provider: provider.provider })
      .catch(() => null);
    const response = asConfigOpResponse(resp);
    if (response?.ok) {
      await deps.onModelConfigurationChanged?.();
      deps.loadApiKeysPanel();
    }
  }

  return {
    renderProviderView,
    renderModelView,
    persistInlineModelsConfig,
    confirmLeave,
    hasUnsavedChanges,
    openApiKeyEditor,
    removeApiKey,
  };
}

/**
 * @param {string} label
 * @param {Element} control
 * @param {string} [hint]
 */
function createField(label, control, hint) {
  const field = document.createElement("label");
  field.className = "models-config-field";
  const caption = document.createElement("span");
  caption.textContent = label;
  field.append(caption, control);
  if (hint) {
    const help = document.createElement("small");
    help.textContent = hint;
    field.appendChild(help);
  }
  return field;
}

/**
 * @param {unknown} value
 * @param {string} [placeholder]
 */
function createInput(value, placeholder = "") {
  const input = document.createElement("input");
  input.className = "ui-input";
  input.value = value == null ? "" : String(value);
  input.placeholder = placeholder;
  input.spellcheck = false;
  return input;
}

/** @param {unknown} error */
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(/** @type {{ message: unknown }} */ (error).message ?? "");
  }
  return "";
}

/** @param {unknown} value */
function asConfigOpResponse(value) {
  if (!value || typeof value !== "object") return /** @type {ConfigOpResponse | null} */ (null);
  return /** @type {ConfigOpResponse} */ (value);
}

/** @param {unknown} el */
function asSaveMessage(el) {
  if (!el || typeof el !== "object") return null;
  if (!("textContent" in el) || !("classList" in el) || !("dataset" in el)) return null;
  return /** @type {SaveMessageEl} */ (el);
}

/** @param {unknown} el */
function asSaveButton(el) {
  if (!el || typeof el !== "object") return null;
  if (!("disabled" in el) || !("textContent" in el)) return null;
  return /** @type {SaveButtonEl} */ (el);
}
