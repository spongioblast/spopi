// ABOUTME: Sets or removes a provider's stored API key from a provider list or sign-in picker row.
// ABOUTME: The key goes to Pi through set_api_key; a custom provider's key row is provider-key-row.js.

import { t } from "../../i18n/i18n.js";
import { confirmDialog } from "../../ui/dialog.js";
import { asConfigOpResponse, errorMessage } from "./config-op-response.js";

/**
 * @typedef {import("./provider-editor.js").ProviderEditorDeps} ProviderEditorDeps
 * @typedef {import("./provider-editor.js").ApiKeyProvider} ApiKeyProvider
 */

/**
 * @param {ProviderEditorDeps} deps
 */
export function createApiKeyEditor(deps) {
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

  return { openApiKeyEditor, removeApiKey };
}
