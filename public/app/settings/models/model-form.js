// ABOUTME: The model form: id, limits, Thinking, default level, images, vLLM budget, Set up model.
// ABOUTME: Edits a draft copy only; the provider editor saves it and returns to the provider view.

import { t } from "../../i18n/i18n.js";
import { select, toggle } from "../../ui/settings-controls.js";
import {
  acceptsImages,
  applySetupResult,
  effectiveThinkingLevel,
  hasThinkingBudget,
  IMAGE_RESIZE_DEFAULTS,
  providerThinkingFormat,
  setAcceptsImages,
  setImageResize,
  setReasoning,
  setThinkingBudget,
  setThinkingControl,
  supportedThinkingLevels,
  thinkingControlOf,
} from "./model-draft.js";
import { runModelSetup } from "./model-setup-panel.js";

/**
 * @typedef {import("./model-draft.js").ModelEntry} ModelEntry
 * @typedef {import("./model-draft.js").ProviderEntry} ProviderEntry
 * @typedef {import("./model-draft.js").SetupResult} SetupResult
 * @typedef {{
 *   provider: string,
 *   index: number | null,
 *   model: ModelEntry,
 *   level?: string | null,
 *   original: string,
 *   setup?: SetupResult | null,
 *   runSetup?: boolean,
 *   server?: string,
 * }} ModelDraft
 * @typedef {(op: string, params?: unknown, options?: unknown) => Promise<unknown>} ConfigCall
 */

/** @param {ModelDraft} draft */
export function modelDraftSnapshot(draft) {
  return JSON.stringify({ model: draft.model, level: draft.level ?? null });
}

/** @param {ModelDraft} draft */
export function isModelDraftDirty(draft) {
  return modelDraftSnapshot(draft) !== draft.original;
}

/**
 * @param {string} label
 * @param {Element} control
 * @param {string} [hint]
 */
function field(label, control, hint) {
  const wrap = document.createElement("label");
  wrap.className = "models-config-field";
  const caption = document.createElement("span");
  caption.textContent = label;
  wrap.append(caption, control);
  if (hint) {
    const help = document.createElement("small");
    help.textContent = hint;
    wrap.appendChild(help);
  }
  return wrap;
}

/**
 * @param {string} label
 * @param {HTMLButtonElement} control
 * @param {string} [hint]
 */
function switchField(label, control, hint) {
  const wrap = document.createElement("div");
  wrap.className = "models-config-field models-config-switch";
  const caption = document.createElement("span");
  caption.textContent = label;
  wrap.append(caption, control);
  if (hint) {
    const help = document.createElement("small");
    help.textContent = hint;
    wrap.appendChild(help);
  }
  return wrap;
}

/**
 * @param {unknown} value
 * @param {string} [placeholder]
 * @param {string} [type]
 */
function input(value, placeholder = "", type = "text") {
  const el = document.createElement("input");
  el.className = "ui-input";
  el.type = type;
  el.value = value == null ? "" : String(value);
  el.placeholder = placeholder;
  el.spellcheck = false;
  return el;
}

/** @param {string} value */
function positiveNumber(value) {
  const number = Number(value.trim());
  return value.trim() && Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

/**
 * @param {HTMLElement} main
 * @param {{
 *   draft: ModelDraft,
 *   providerEntry: ProviderEntry,
 *   call: ConfigCall,
 *   onBack: () => void,
 *   onSave: (button: HTMLButtonElement, error: HTMLElement) => void,
 *   onDelete?: () => void,
 * }} options
 */
export function renderModelForm(main, { draft, providerEntry, call, onBack, onSave, onDelete }) {
  const model = draft.model;
  const isNew = draft.index === null;

  const header = document.createElement("div");
  header.className = "models-config-detail-header models-config-breadcrumb-header";
  const crumbs = document.createElement("nav");
  crumbs.className = "models-config-breadcrumb";
  crumbs.setAttribute("aria-label", t("models.breadcrumb"));
  const back = document.createElement("button");
  back.type = "button";
  back.className = "models-config-crumb models-config-back";
  back.textContent = `‹ ${draft.provider}`;
  back.setAttribute("aria-label", t("models.backTo", { provider: draft.provider }));
  back.addEventListener("click", onBack);
  const separator = document.createElement("span");
  separator.className = "models-config-crumb-separator";
  separator.setAttribute("aria-hidden", "true");
  separator.textContent = "›";
  const current = document.createElement("span");
  current.className = "models-config-crumb models-config-crumb-current";
  current.textContent = isNew ? t("models.newModel") : model.id || t("models.unnamedModel");
  crumbs.append(back, separator, current);
  header.appendChild(crumbs);
  if (!isNew && onDelete) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ui-button ui-button--danger ui-button--sm models-model-delete";
    remove.textContent = t("models.delete");
    remove.addEventListener("click", onDelete);
    header.appendChild(remove);
  }

  const form = document.createElement("div");
  form.className = "models-config-form models-model-form";

  const id = input(model.id, t("models.modelIdPlaceholder"));
  id.classList.add("models-model-id-input");
  id.addEventListener("input", () => {
    const value = id.value.trim();
    if (value) model.id = value;
    else delete model.id;
    current.textContent = value || (isNew ? t("models.newModel") : t("models.unnamedModel"));
  });
  const name = input(model.name, t("models.optional"));
  name.addEventListener("input", () => {
    if (name.value.trim()) model.name = name.value.trim();
    else delete model.name;
  });
  const contextWindow = input(model.contextWindow, t("models.optional"), "number");
  contextWindow.addEventListener("input", () => {
    const value = positiveNumber(contextWindow.value);
    if (value) model.contextWindow = value;
    else delete model.contextWindow;
  });
  const maxTokens = input(model.maxTokens, t("models.optional"), "number");
  maxTokens.addEventListener("input", () => {
    const value = positiveNumber(maxTokens.value);
    if (value) model.maxTokens = value;
    else delete model.maxTokens;
  });
  form.append(
    field(t("models.modelId"), id),
    field(t("models.displayName"), name),
    field(t("models.contextWindow"), contextWindow),
    field(t("models.maxTokens"), maxTokens),
  );

  const capabilities = document.createElement("div");
  capabilities.className = "models-model-capabilities";
  form.appendChild(capabilities);

  function paintCapabilities() {
    capabilities.replaceChildren();
    capabilities.appendChild(
      switchField(
        t("models.thinking"),
        toggle({
          checked: model.reasoning === true,
          label: t("models.thinking"),
          onChange: (on) => {
            setReasoning(model, on);
            paintCapabilities();
          },
        }),
        t("models.thinkingHint"),
      ),
    );
    if (model.reasoning === true) {
      const control = thinkingControlOf(model, providerEntry);
      const options = [
        { value: "none", label: t("models.thinkingControl.none") },
        { value: "reasoning-effort", label: t("models.thinkingControl.reasoningEffort") },
        { value: "qwen-chat-template", label: t("models.thinkingControl.qwen") },
        { value: "chat-template", label: t("models.thinkingControl.chatTemplate") },
      ];
      if (control === "other") {
        options.push({
          value: "other",
          label: t("models.thinkingControl.other", {
            format: String(model.compat?.thinkingFormat || providerThinkingFormat(providerEntry)),
          }),
        });
      }
      const fromProvider = providerThinkingFormat(providerEntry);
      capabilities.appendChild(
        field(
          t("models.thinkingControl.label"),
          select({
            options,
            value: control,
            label: t("models.thinkingControl.label"),
            className: "ui-select models-thinking-control",
            onChange: (value) => {
              setThinkingControl(model, /** @type {never} */ (value));
              paintCapabilities();
            },
          }),
          fromProvider
            ? t("models.thinkingControl.fromProvider", { format: fromProvider })
            : t("models.thinkingControl.hint"),
        ),
      );
      const levels = supportedThinkingLevels(model);
      capabilities.appendChild(
        field(
          t("models.defaultLevel"),
          select({
            options: levels.map((level) => ({
              value: level,
              label: t(`settings.thinkingLevels.${level}`),
            })),
            value: effectiveThinkingLevel(model, draft.level),
            label: t("models.defaultLevel"),
            className: "ui-select models-default-level",
            onChange: (value) => {
              draft.level = value;
            },
          }),
          t("models.defaultLevelHint"),
        ),
      );
      capabilities.appendChild(
        switchField(
          t("models.thinkingBudget"),
          toggle({
            checked: hasThinkingBudget(model),
            label: t("models.thinkingBudget"),
            onChange: (on) => setThinkingBudget(model, on),
          }),
          t("models.thinkingBudgetHint"),
        ),
      );
    }
    capabilities.appendChild(
      switchField(
        t("models.images"),
        toggle({
          checked: acceptsImages(model),
          label: t("models.images"),
          onChange: (on) => {
            setAcceptsImages(model, on);
            paintCapabilities();
          },
        }),
        t("models.imagesHint"),
      ),
    );
    if (acceptsImages(model)) {
      const resize = model.inputLimits?.images?.resize || {};
      const row = document.createElement("div");
      row.className = "models-image-resize";
      /** @type {Array<["maxWidth" | "maxHeight" | "maxBytes", string, number]>} */
      const fields = [
        ["maxWidth", t("models.imageMaxWidth"), 1],
        ["maxHeight", t("models.imageMaxHeight"), 1],
        ["maxBytes", t("models.imageMaxKb"), 1024],
      ];
      for (const [key, label, scale] of fields) {
        const value = resize[key] ?? IMAGE_RESIZE_DEFAULTS[key];
        const box = input(Math.round(value / scale), "", "number");
        box.dataset.resize = key;
        box.addEventListener("input", () => {
          const next = positiveNumber(box.value);
          setImageResize(model, key, next ? next * scale : undefined);
        });
        row.appendChild(field(label, box));
      }
      capabilities.appendChild(row);
    }
  }
  paintCapabilities();

  const setupSection = document.createElement("div");
  setupSection.className = "models-model-setup";
  const setupButton = document.createElement("button");
  setupButton.type = "button";
  setupButton.className = "ui-button ui-button--secondary ui-button--sm models-model-setup-run";
  setupButton.textContent = t("models.setup.button");
  const setupHint = document.createElement("small");
  setupHint.textContent = t("models.setup.hint");
  const setupPanel = document.createElement("div");
  setupPanel.hidden = true;
  const startSetup = async () => {
    const modelId = String(model.id || "").trim();
    if (!modelId) {
      error.textContent = t("models.modelIdRequired");
      error.hidden = false;
      return;
    }
    error.hidden = true;
    setupButton.disabled = true;
    const result = await runModelSetup({
      call,
      provider: draft.provider,
      modelId,
      server: draft.server,
      container: setupPanel,
    });
    setupButton.disabled = false;
    if (!result) return;
    draft.setup = result;
    applySetupResult(model, result);
    if (result.suggestion?.contextWindow) contextWindow.value = String(model.contextWindow ?? "");
    if (model.reasoning && !draft.level) draft.level = effectiveThinkingLevel(model, null);
    paintCapabilities();
  };
  setupButton.addEventListener("click", () => void startSetup());
  setupSection.append(setupButton, setupHint, setupPanel);
  form.appendChild(setupSection);

  const error = document.createElement("p");
  error.className = "models-config-form-error";
  error.hidden = true;
  const footer = document.createElement("div");
  footer.className = "models-model-form-footer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button ui-button--ghost models-model-cancel";
  cancel.textContent = t("actions.cancel");
  cancel.addEventListener("click", onBack);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "ui-button ui-button--primary models-model-save";
  save.textContent = isNew ? t("models.addModelSave") : t("models.saveModel");
  save.addEventListener("click", () => onSave(save, error));
  footer.append(cancel, save);
  form.append(error, footer);

  main.append(header, form);
  if (draft.runSetup) {
    draft.runSetup = false;
    void startSetup();
  }
}
