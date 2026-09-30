// ABOUTME: Opens the custom provider editor: detect, pick models, test, save.
// ABOUTME: Detection reads model lists only; the key is optional for local servers.

// Guided custom / relay provider form. Detects OpenAI-compatible vs
// Anthropic protocols, lists upstream models, tests connectivity, then saves
// into models.json via spopi-config (a typed key goes to auth.json).

import { t } from "../i18n/i18n.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { toggle } from "../ui/settings-controls.js";

const PROBE_TIMEOUT_MS = 45_000;

/**
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   reasoning?: boolean,
 * }} CustomProviderModel
 *
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: {
 *     protocol?: string,
 *     error?: string,
 *     models?: CustomProviderModel[],
 *     server?: string,
 *     suggestedId?: string,
 *     ok?: boolean,
 *     latencyMs?: number | string,
 *     keyStored?: boolean,
 *     providerId?: string,
 *     modelCount?: number,
 *   },
 * }} CustomProviderCallResult
 *
 * @typedef {(
 *   op: string,
 *   params?: Record<string, unknown>,
 *   options?: { timeoutMs?: number },
 * ) => Promise<CustomProviderCallResult>} CustomProviderCall
 *
 * @typedef {(
 *   title: string,
 *   subtitle: string,
 * ) => { backdrop: HTMLElement, dialog: HTMLElement }} CustomProviderSetupDialog
 *
 * @typedef {{
 *   server?: string,
 *   modelIds: string[],
 * }} CustomProviderSavedInfo
 *
 * @typedef {{
 *   call: CustomProviderCall,
 *   setupDialog: CustomProviderSetupDialog,
 *   onSaved?: (
 *     providerId: string | undefined,
 *     info: CustomProviderSavedInfo,
 *   ) => unknown | Promise<unknown>,
 * }} OpenCustomProviderEditorOptions
 */

/**
 * @param {string} labelText
 * @param {HTMLElement} input
 * @param {string} [hint]
 */
function createField(labelText, input, hint) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  wrap.appendChild(input);
  if (hint) {
    const note = document.createElement("span");
    note.className = "custom-provider-field-hint";
    note.textContent = hint;
    wrap.appendChild(note);
  }
  return wrap;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageFromUnknown(error) {
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

/** @param {number} tokens */
export function formatContextTokens(tokens) {
  if (tokens < 1000) return String(tokens);
  if (tokens % 1000 === 0) return `${tokens / 1000}k`;
  if (tokens % 1024 === 0) return `${tokens / 1024}k`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * @param {OpenCustomProviderEditorOptions} options
 */
export function openCustomProviderEditor({ call, setupDialog, onSaved }) {
  const { backdrop, dialog } = setupDialog(
    t("settings.customProvider.title"),
    t("settings.customProvider.subtitle"),
  );
  const form = document.createElement("div");
  form.className = "provider-setup-form";

  const providerId = document.createElement("input");
  providerId.className = "ui-input";
  providerId.placeholder = t("settings.customProvider.idPlaceholder");
  const baseUrl = document.createElement("input");
  baseUrl.className = "ui-input";
  baseUrl.placeholder = "http://127.0.0.1:8000/v1";
  const apiKey = document.createElement("input");
  apiKey.className = "ui-input";
  apiKey.type = "password";
  apiKey.autocomplete = "off";
  apiKey.placeholder = t("settings.customProvider.apiKeyPlaceholder");
  const protocol = document.createElement("select");
  protocol.className = "ui-select";
  for (const [value, label] of [
    ["auto", t("settings.customProvider.protocolAuto")],
    ["openai-completions", t("settings.customProvider.protocolOpenAi")],
    ["anthropic-messages", t("settings.customProvider.protocolAnthropic")],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    protocol.appendChild(option);
  }

  form.append(
    createField(t("settings.customProvider.baseUrl"), baseUrl),
    createField(
      t("settings.customProvider.apiKey"),
      apiKey,
      t("settings.customProvider.apiKeyHint"),
    ),
    createField(t("settings.customProvider.id"), providerId),
    createField(t("settings.customProvider.protocol"), protocol),
  );
  dialog.appendChild(form);
  const protocolMenu = enhanceSelect(protocol);

  const modelsWrap = document.createElement("div");
  modelsWrap.className = "custom-provider-models hidden";
  const modelsHead = document.createElement("div");
  modelsHead.className = "custom-provider-models-head";
  const modelsTitle = document.createElement("span");
  modelsTitle.textContent = t("settings.customProvider.models");
  const selectAll = document.createElement("button");
  selectAll.type = "button";
  selectAll.className = "ui-button ui-button--ghost ui-button--sm";
  selectAll.textContent = t("settings.customProvider.deselectAll");
  modelsHead.append(modelsTitle, selectAll);
  const modelsList = document.createElement("div");
  modelsList.className = "custom-provider-models-list";
  const modelsNote = document.createElement("p");
  modelsNote.className = "custom-provider-models-note";
  modelsNote.textContent = t("settings.customProvider.modelsNote");
  modelsWrap.append(modelsHead, modelsList, modelsNote);
  dialog.appendChild(modelsWrap);

  const status = document.createElement("div");
  status.className = "custom-provider-status hidden";
  status.setAttribute("role", "status");
  dialog.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "provider-setup-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button ui-button--secondary custom-provider-cancel";
  cancel.textContent = t("actions.cancel");
  cancel.onclick = () => backdrop.remove();
  const detectBtn = document.createElement("button");
  detectBtn.type = "button";
  detectBtn.className = "ui-button ui-button--secondary custom-provider-detect";
  detectBtn.textContent = t("settings.customProvider.detect");
  const testBtn = document.createElement("button");
  testBtn.type = "button";
  testBtn.className = "ui-button ui-button--secondary custom-provider-test";
  testBtn.textContent = t("settings.customProvider.test");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ui-button ui-button--primary custom-provider-save";
  saveBtn.textContent = t("settings.customProvider.save");
  actions.append(cancel, detectBtn, testBtn, saveBtn);
  dialog.appendChild(actions);

  /** @type {CustomProviderModel[]} */
  let detectedModels = [];
  /** @type {Map<string, boolean>} */
  const thinkingById = new Map();
  /** Context sizes the user entered for models the server did not describe. */
  /** @type {Map<string, number>} */
  const contextById = new Map();
  /** @type {{ signature: string, protocol: string, server?: string } | null} */
  let detection = null;
  /** @type {Promise<boolean> | null} */
  let detecting = null;
  let providerIdAutoFilled = false;

  providerId.addEventListener("input", () => {
    providerIdAutoFilled = false;
  });

  function signature() {
    return [baseUrl.value.trim(), apiKey.value.trim(), protocol.value].join("\n");
  }

  /**
   * @param {string} [message]
   * @param {"error" | "ok" | undefined} [kind]
   */
  function setStatus(message, kind) {
    if (!message) {
      status.textContent = "";
      status.classList.add("hidden");
      status.classList.remove("is-error", "is-ok");
      return;
    }
    status.textContent = message;
    status.classList.remove("hidden", "is-error", "is-ok");
    if (kind === "error") status.classList.add("is-error");
    if (kind === "ok") status.classList.add("is-ok");
  }

  /**
   * @param {unknown} models
   */
  function renderModels(models) {
    detectedModels = Array.isArray(models)
      ? models
          .filter((model) => model && typeof model === "object" && "id" in model)
          .map((model) => /** @type {CustomProviderModel} */ (model))
      : [];
    thinkingById.clear();
    contextById.clear();
    modelsList.replaceChildren();
    if (detectedModels.length === 0) {
      modelsWrap.classList.add("hidden");
      return;
    }
    modelsWrap.classList.remove("hidden");
    for (const model of detectedModels) {
      thinkingById.set(model.id, model.reasoning === true);
      const row = document.createElement("div");
      row.className = "custom-provider-model-row";
      const pick = document.createElement("label");
      pick.className = "custom-provider-model-pick";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "custom-provider-model-toggle";
      checkbox.value = model.id;
      checkbox.checked = true;
      const label = document.createElement("span");
      label.className = "custom-provider-model-id";
      label.textContent =
        model.name && model.name !== model.id ? `${model.id} · ${model.name}` : model.id;
      pick.append(checkbox, label);
      const meta = document.createElement("span");
      meta.className = "custom-provider-model-meta";
      if (model.contextWindow) {
        meta.dataset.contextWindow = String(model.contextWindow);
        meta.textContent = t("settings.customProvider.contextShort", {
          tokens: formatContextTokens(model.contextWindow),
        });
      } else {
        // The server does not say; the user knows the size their model runs with.
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.step = "1";
        input.className = "ui-input custom-provider-model-context";
        input.placeholder = t("settings.customProvider.contextUnknown");
        input.title = t("settings.customProvider.contextUnknownHint");
        input.setAttribute(
          "aria-label",
          t("settings.customProvider.contextFor", { model: model.id }),
        );
        input.addEventListener("input", () => {
          const tokens = Math.floor(Number(input.value));
          if (Number.isFinite(tokens) && tokens > 0) contextById.set(model.id, tokens);
          else contextById.delete(model.id);
        });
        meta.append(input);
      }
      const thinking = document.createElement("span");
      thinking.className = "custom-provider-model-thinking";
      const thinkingLabel = document.createElement("span");
      thinkingLabel.textContent = t("settings.customProvider.thinking");
      thinking.append(
        thinkingLabel,
        toggle({
          checked: model.reasoning === true,
          label: t("settings.customProvider.thinkingFor", { model: model.id }),
          onChange: (next) => thinkingById.set(model.id, next),
        }),
      );
      row.append(pick, meta, thinking);
      modelsList.appendChild(row);
    }
    selectAll.textContent = t("settings.customProvider.deselectAll");
  }

  function selectedModels() {
    const selectedIds = new Set(
      [...modelsList.querySelectorAll(".custom-provider-model-toggle:checked")]
        .filter((node) => "value" in node)
        .map((node) => String(/** @type {{ value: string }} */ (node).value)),
    );
    return detectedModels
      .filter((model) => selectedIds.has(model.id))
      .map((model) => {
        const entered = contextById.get(model.id);
        return {
          ...model,
          reasoning: thinkingById.get(model.id) === true,
          ...(entered ? { contextWindow: entered } : {}),
        };
      });
  }

  function resolvedProtocol() {
    if (protocol.value !== "auto") return protocol.value;
    return detection?.signature === signature() ? detection.protocol : null;
  }

  selectAll.addEventListener("click", () => {
    const toggles = [...modelsList.querySelectorAll(".custom-provider-model-toggle")].filter(
      (node) => "checked" in node,
    );
    const allChecked =
      toggles.length > 0 &&
      toggles.every((toggle) => /** @type {{ checked?: boolean }} */ (toggle).checked);
    for (const toggle of toggles) {
      /** @type {{ checked: boolean }} */ (toggle).checked = !allChecked;
    }
    selectAll.textContent = allChecked
      ? t("settings.customProvider.selectAll")
      : t("settings.customProvider.deselectAll");
  });

  async function detect() {
    if (!baseUrl.value.trim()) {
      setStatus(t("settings.customProvider.baseUrlRequired"), "error");
      return false;
    }
    const current = signature();
    const preferred = protocol.value;
    detectBtn.disabled = true;
    setStatus(t("settings.customProvider.detecting"));
    try {
      const resp = await call(
        "detect_custom_provider",
        { baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), preferred },
        { timeoutMs: PROBE_TIMEOUT_MS },
      );
      if (!resp?.ok) throw new Error(resp?.error || t("settings.customProvider.detectFailed"));
      const data = resp.data || {};
      if (!data.protocol || data.protocol === "unknown") {
        throw new Error(
          data.error
            ? t("settings.customProvider.detectFailedWith", { detail: data.error })
            : t("settings.customProvider.detectFailed"),
        );
      }
      detection = { signature: current, protocol: data.protocol, server: data.server };
      if (preferred === "auto") {
        protocol.value = data.protocol;
        protocolMenu?.sync();
        detection.signature = signature();
      }
      if (data.suggestedId && (!providerId.value.trim() || providerIdAutoFilled)) {
        providerId.value = data.suggestedId;
        providerIdAutoFilled = true;
      }
      renderModels(data.models);
      setStatus(
        t(
          data.server
            ? "settings.customProvider.detectedServer"
            : "settings.customProvider.detected",
          {
            protocol: data.protocol,
            server: data.server || "",
            count: data.models?.length ?? 0,
          },
        ),
        "ok",
      );
      return true;
    } catch (error) {
      detection = null;
      setStatus(messageFromUnknown(error), "error");
      return false;
    } finally {
      detectBtn.disabled = false;
    }
  }

  function runDetect() {
    if (!detecting) {
      detecting = detect().finally(() => {
        detecting = null;
      });
    }
    return detecting;
  }

  baseUrl.addEventListener("blur", () => {
    if (!baseUrl.value.trim() || detection?.signature === signature()) return;
    void runDetect();
  });

  detectBtn.addEventListener("click", () => {
    if (protocol.value !== "auto" && detection && detection.protocol !== protocol.value) {
      detection = null;
    }
    void runDetect();
  });

  testBtn.addEventListener("click", async () => {
    if (!resolvedProtocol() && !(await runDetect())) return;
    const nextProtocol = resolvedProtocol();
    if (!baseUrl.value.trim() || !nextProtocol) {
      setStatus(t("settings.customProvider.detectFirst"), "error");
      return;
    }
    testBtn.disabled = true;
    setStatus(t("settings.customProvider.testing"));
    try {
      const selected = selectedModels();
      const resp = await call(
        "test_custom_provider",
        {
          baseUrl: baseUrl.value.trim(),
          apiKey: apiKey.value.trim(),
          protocol: nextProtocol,
          modelId: selected[0]?.id,
        },
        { timeoutMs: PROBE_TIMEOUT_MS },
      );
      if (!resp?.ok) throw new Error(resp?.error || t("settings.customProvider.testFailed"));
      if (!resp.data?.ok) {
        throw new Error(resp.data?.error || t("settings.customProvider.testFailed"));
      }
      setStatus(t("settings.customProvider.testOk", { ms: resp.data.latencyMs ?? "—" }), "ok");
    } catch (error) {
      setStatus(messageFromUnknown(error), "error");
    } finally {
      testBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!baseUrl.value.trim()) {
      setStatus(t("settings.customProvider.baseUrlRequired"), "error");
      return;
    }
    saveBtn.disabled = true;
    try {
      if (detecting) await detecting;
      if (!resolvedProtocol() && !(await runDetect())) return;
      const nextProtocol = resolvedProtocol();
      if (!nextProtocol) {
        setStatus(t("settings.customProvider.detectFirst"), "error");
        return;
      }
      const models = selectedModels();
      if (models.length === 0) {
        setStatus(t("settings.customProvider.modelsRequired"), "error");
        return;
      }
      setStatus(t("settings.customProvider.saving"));
      const key = apiKey.value.trim();
      const resp = await call("save_custom_provider", {
        providerId: providerId.value.trim(),
        baseUrl: baseUrl.value.trim(),
        apiKey: key,
        protocol: nextProtocol,
        server: detection?.server,
        models,
        storeKey: Boolean(key),
        includeApiKeyInFile: false,
      });
      if (!resp?.ok) throw new Error(resp?.error || t("settings.customProvider.saveFailed"));
      const keyNote = key
        ? resp.data?.keyStored
          ? t("settings.customProvider.keyStored")
          : t("settings.customProvider.keyNotStored")
        : t("settings.customProvider.keyless");
      setStatus(
        t("settings.customProvider.saved", {
          id: resp.data?.providerId || providerId.value.trim(),
          count: resp.data?.modelCount ?? models.length,
        }) + keyNote,
        "ok",
      );
      await onSaved?.(resp.data?.providerId, {
        server: detection?.server,
        modelIds: models.map((model) => model.id),
      });
      backdrop.remove();
    } catch (error) {
      setStatus(messageFromUnknown(error), "error");
    } finally {
      saveBtn.disabled = false;
    }
  });
}
