// ABOUTME: The model step of the Models editor: open a model draft, save or delete it, return to its provider.
// ABOUTME: A model saves on its own, with its thinking level; the provider draft is left as it was.

import { t } from "../../i18n/i18n.js";
import { confirmDialog } from "../../ui/dialog.js";
import { cloneEntry, effectiveThinkingLevel } from "./model-draft.js";
import { modelDraftSnapshot, renderModelForm } from "./model-form.js";

/**
 * @typedef {import("./provider-editor.js").ProviderEditorDeps} ProviderEditorDeps
 * @typedef {import("./provider-editor.js").ModelsConfigSelection} ModelsConfigSelection
 * @typedef {import("./model-form.js").ModelDraft} ModelDraft
 * @typedef {ReturnType<typeof import("./models-config-document.js").createModelsConfigDocument>} ModelsConfigDocument
 *
 * @typedef {object} ModelEditFlowDeps
 * @property {ProviderEditorDeps} deps
 * @property {ModelsConfigDocument} config
 * @property {(options?: { keepProvider?: boolean }) => Promise<boolean>} confirmLeave
 */

/**
 * @param {ModelEditFlowDeps} flowDeps
 */
export function createModelEditFlow({ deps, config, confirmLeave }) {
  const { view } = deps;
  const { readBase, persistConfig } = config;

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

  return { openModel, deleteModel, renderModelView };
}
