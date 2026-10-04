// ABOUTME: Reads and writes the models.json document behind the Models editor and its Advanced JSON dialog.
// ABOUTME: Callers edit a parsed copy; this file owns the write, the textarea mirror, and the change notice.

import { t } from "../../i18n/i18n.js";
import {
  clearSettingsSaveMessage,
  setSettingsSaveButtonSaving,
  showSettingsSaveError,
  showSettingsSaveSuccess,
} from "../settings-save-status.js";
import { asConfigOpResponse, errorMessage } from "./config-op-response.js";

/**
 * @typedef {import("./provider-editor.js").ProviderEditorDeps} ProviderEditorDeps
 * @typedef {import("./provider-editor.js").ModelsJsonConfig} ModelsJsonConfig
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
 */

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
export function createModelsConfigDocument(deps) {
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

  return { readBase, persistConfig, persistInlineModelsConfig };
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
