// ABOUTME: Edits one models.json provider: its fields, key, and rename, and composes the model flow.
// ABOUTME: Provider fields are a draft until Save provider; a model saves on its own and returns here.

import { t } from "../../i18n/i18n.js";
import { confirmDialog } from "../../ui/dialog.js";
import { enhanceSelect } from "../../ui/select-menu.js";
import { createApiKeyEditor } from "./api-key-editor.js";
import { asConfigOpResponse, errorMessage } from "./config-op-response.js";
import { createModelEditFlow } from "./model-edit-flow.js";
import { isModelDraftDirty } from "./model-form.js";
import { renderModelSetupOffer } from "./model-setup-offer.js";
import { createModelsConfigDocument } from "./models-config-document.js";
import { createProviderKeyRow } from "./provider-key-row.js";
import { renderProviderModelsList } from "./provider-models-list.js";

export { changedProviders } from "./models-config-document.js";

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
 * @typedef {(
 *   op: string,
 *   params?: unknown,
 *   options?: unknown,
 * ) => Promise<unknown>} ModelsConfigCall
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
 * @param {ProviderEditorDeps} deps
 */
export function createProviderEditor(deps) {
  const { view } = deps;
  const config = createModelsConfigDocument(deps);
  const { readBase, persistConfig } = config;
  const modelFlow = createModelEditFlow({ deps, config, confirmLeave });
  const { openModel, deleteModel } = modelFlow;

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
    renderModelSetupOffer(main, providerName, { view, models: entry.models || [], openModel });
    main.appendChild(form);
    refreshDirty();
    queueMicrotask(() => {
      if (api.isConnected) enhanceSelect(api);
    });
    renderProviderModelsList(main, providerName, entry, { deps, openModel, deleteModel });
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

  return {
    renderProviderView,
    renderModelView: modelFlow.renderModelView,
    persistInlineModelsConfig: config.persistInlineModelsConfig,
    confirmLeave,
    hasUnsavedChanges,
    ...createApiKeyEditor(deps),
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
