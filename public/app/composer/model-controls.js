// ABOUTME: Composer model menu and thinking-level control.
// ABOUTME: Selection is sent to the runtime and stored on the session profile.

import { formatModelName, formatThinkingLevelLabel } from "../session/session-log.js";
import { registerModelCycle } from "../utils/keyboard-shortcuts.js";
import { randomId } from "../utils/random-id.js";
import { getLastModel, setLastModel } from "./last-model-store.js";
import { createModelDropdown } from "./model-dropdown.js";
import {
  applyConfiguredModelVisibility,
  applyVisibilityThinkingLevel,
  findModelContextWindow,
} from "./model-visibility.js";

/**
 * @param {{ type?: string, level?: unknown } | null | undefined} event
 * @param {(level: unknown) => void} update
 */
export function applyThinkingLevelChanged(event, update) {
  applyVisibilityThinkingLevel(event, update);
}

/**
 * @typedef {import("./model-visibility.js").ComposerModel} ComposerModel
 * @typedef {import("./model-dropdown.js").ModelDropdownModel} ModelDropdownModel
 *
 * @typedef {{
 *   provider?: string | null,
 *   modelId?: string | null,
 *   thinkingLevel?: string,
 *   contextWindow?: number,
 *   available?: ComposerModel[],
 *   availableLoaded?: boolean,
 *   scopedIds?: string[],
 *   scopedLoaded?: boolean,
 * }} ComposerModelState
 *
 * @typedef {{
 *   response?: {
 *     data?: {
 *       models?: ComposerModel[],
 *       thinkingLevel?: string,
 *       level?: string,
 *       model?: { provider?: string, id?: string, contextWindow?: number },
 *     },
 *   },
 * }} RuntimeRequestResult
 *
 * @param {{
 *   state: ComposerModelState,
 *   thinkingBtn?: HTMLElement | null,
 *   modelDropdown?: Element | null,
 *   modelDropdownBtn?: Element | null,
 *   modelDropdownLabel?: HTMLElement | null,
 *   modelDropdownMenu?: Element | null,
 *   sessionUiState: {
 *     saveProfile: (profile: {
 *       provider: string,
 *       modelId: string,
 *       thinkingLevel?: string,
 *     }) => Promise<unknown>,
 *   },
 *   contextUsage: { setContextWindowSize: (size: number) => void },
 *   runtime: {
 *     request: (
 *       payload: unknown,
 *       target: unknown,
 *       opts?: unknown,
 *     ) => Promise<RuntimeRequestResult>,
 *   },
 *   getTarget: () => unknown,
 *   config: {
 *     call: (
 *       method: string,
 *       args?: Record<string, unknown>,
 *     ) => Promise<{
 *       ok?: boolean,
 *       error?: string,
 *       data?: {
 *         modelIds?: string[],
 *         providers?: Array<{
 *           provider?: string,
 *           models?: Array<{
 *             available?: boolean,
 *             visible?: boolean,
 *             provider?: string,
 *             id?: string,
 *           }>,
 *         }>,
 *       },
 *     }>,
 *   },
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   onLocaleChange: (handler: () => void) => (() => void) | void,
 *   showError: (error: unknown) => void,
 *   openModelSettings?: (() => void) | null,
 *   onThinkingUnavailable?: (() => void) | null,
 *   onModelStatusChange?: ((status: import("./send-model-gate.js").ModelStatus) => void) | null,
 * }} options
 */
export function mountModelControls({
  state,
  thinkingBtn,
  modelDropdown,
  modelDropdownBtn,
  modelDropdownLabel,
  modelDropdownMenu,
  sessionUiState,
  contextUsage,
  runtime,
  getTarget,
  config,
  t,
  onLocaleChange,
  showError,
  openModelSettings,
  onThinkingUnavailable,
  onModelStatusChange,
}) {
  /** Pi offers no levels for this model; known once cycling returned nothing. */
  let thinkingUnavailable = false;
  let selectedModelName = "";
  /** Set once a session reported its model, so the label before that is not read as "no model". */
  let modelReported = false;
  const toolbar = modelDropdown?.closest(".composer-toolbar");

  /**
   * The label says when Pi runs no model, or, once the list is known, when the picker
   * offers nothing or lost the selection.
   */
  function renderModelLabel() {
    const available = state.available ?? [];
    const listed = available.some(
      (model) => model.provider === state.provider && model.id === state.modelId,
    );
    const noModel = modelReported && !state.modelId;
    const missing = noModel || (Boolean(state.availableLoaded) && !listed);
    const status = !missing
      ? "ready"
      : state.availableLoaded && available.length === 0
        ? "none"
        : "unselected";
    onModelStatusChange?.(status);
    if (!modelDropdownLabel) return;
    if (!missing) {
      modelDropdownLabel.textContent = selectedModelName || "model";
    } else {
      modelDropdownLabel.textContent =
        status === "none" ? t("composer.noModel") : t("composer.chooseModel");
    }
    modelDropdownLabel.classList.toggle("is-unset", missing);
  }

  /** @param {ModelDropdownModel | null | undefined} model */
  function updateComposerModel(model) {
    thinkingUnavailable = false;
    modelReported = true;
    state.provider = model?.provider ?? null;
    state.modelId = model?.id ?? null;
    sessionUiState
      .saveProfile({
        provider: state.provider || "",
        modelId: state.modelId || "",
        thinkingLevel: state.thinkingLevel,
      })
      .catch(() => {});
    state.contextWindow =
      Number(model?.contextWindow) ||
      findModelContextWindow(state.available, state.provider, state.modelId);
    contextUsage.setContextWindowSize(state.contextWindow);
    selectedModelName = formatModelName(model) || "";
    renderModelLabel();
  }

  /** @param {string | null | undefined} level */
  function updateComposerThinking(level) {
    state.thinkingLevel = level ?? "off";
    sessionUiState
      .saveProfile({
        provider: state.provider || "",
        modelId: state.modelId || "",
        thinkingLevel: state.thinkingLevel,
      })
      .catch(() => {});
    if (thinkingBtn) {
      const levelLabel = formatThinkingLevelLabel(state.thinkingLevel, t);
      thinkingBtn.textContent = t("settings.thinkingCompact", { level: levelLabel });
      thinkingBtn.className = `thinking-tag${state.thinkingLevel === "off" ? " off" : ""}`;
      thinkingBtn.dataset.compact = "true";
      thinkingBtn.title = thinkingUnavailable
        ? t("composer.noThinkingLevels")
        : t("settings.thinkingTitle");
      thinkingBtn.setAttribute(
        "aria-label",
        t("settings.thinkingAriaLabel", { level: levelLabel }),
      );
    }
  }

  /**
   * @param {{ force?: boolean }} [options]
   */
  async function loadAvailableModels({ force = false } = {}) {
    if (state.availableLoaded && !force) return;
    try {
      const result = await runtime.request({ type: "get_available_models" }, getTarget());
      const runtimeModels = result?.response?.data?.models ?? [];
      state.available = await applyConfiguredModelVisibility(runtimeModels, config);
      state.availableLoaded = true;
      if (!state.contextWindow) {
        state.contextWindow = findModelContextWindow(
          state.available,
          state.provider,
          state.modelId,
        );
        contextUsage.setContextWindowSize(state.contextWindow);
      }
      renderModelLabel();
      renderModelDropdownMenu();
    } catch (error) {
      console.warn("[spopi] Failed to load available models:", error);
    }
  }

  /**
   * @param {{ force?: boolean }} [options]
   */
  async function loadScopedModelIds({ force = false } = {}) {
    if (state.scopedLoaded && !force) return;
    try {
      const response = await config.call("list_scoped_models");
      if (response?.ok && Array.isArray(response.data?.modelIds)) {
        state.scopedIds = response.data.modelIds;
        state.scopedLoaded = true;
      }
    } catch {
      // An unavailable config bridge degrades to the ungrouped enabled list.
    }
  }

  const modelDropdownUi = createModelDropdown({
    t,
    elements: {
      menu: modelDropdownMenu,
      dropdown: modelDropdown,
      toolbar,
      btn: modelDropdownBtn,
    },
    getSelection: () => ({
      provider: state.provider ?? undefined,
      modelId: state.modelId ?? undefined,
    }),
    getAvailableModels: () => state.available,
    getScopedModelIds: () => state.scopedIds,
    /**
     * @param {ModelDropdownModel} model
     * @param {boolean} enabled
     */
    setScopedModelIds: async (model, enabled) => {
      const response = await config.call("set_scoped_model", {
        provider: model.provider,
        modelId: model.id,
        enabled,
      });
      if (response?.ok && Array.isArray(response.data?.modelIds)) {
        state.scopedIds = response.data.modelIds;
        return state.scopedIds;
      }
      return null;
    },
    loadScoped: () => (state.scopedLoaded ? Promise.resolve() : loadScopedModelIds()),
    /** @param {ModelDropdownModel} model */
    onSelect: async (model) => {
      try {
        await runtime.request(
          { type: "set_model", provider: model.provider, modelId: model.id },
          getTarget(),
          { idempotencyKey: randomId() },
        );
        setLastModel(model);
        updateComposerModel(model);
      } catch (error) {
        showError(error);
      }
    },
    onOpenSettings: () => openModelSettings?.(),
  });

  function renderModelDropdownMenu() {
    modelDropdownUi.renderMenu();
  }

  function closeModelDropdown() {
    modelDropdownUi.close();
  }

  /** @param {Event} event */
  function onDropdownClick(event) {
    event.stopPropagation();
    const isOpen = !modelDropdownMenu?.classList.contains("hidden");
    if (isOpen) {
      closeModelDropdown();
      return;
    }
    if (!state.availableLoaded) loadAvailableModels();
    modelDropdownUi.open();
  }

  /** @param {Event} event */
  function onDocumentClick(event) {
    if (!modelDropdown?.contains(/** @type {Node | null} */ (event.target))) closeModelDropdown();
  }

  modelDropdownBtn?.addEventListener("click", onDropdownClick);
  document.addEventListener("click", onDocumentClick);

  const storedInitialModel = getLastModel();
  if (storedInitialModel) {
    selectedModelName = formatModelName({ id: storedInitialModel.modelId }) || "";
    renderModelLabel();
  }
  const stopLocale = onLocaleChange(() => {
    updateComposerThinking(state.thinkingLevel);
    renderModelLabel();
  });
  thinkingBtn?.addEventListener("click", async () => {
    if (modelReported && !state.modelId) {
      openModelPicker();
      return;
    }
    try {
      const result = await runtime.request({ type: "cycle_thinking_level" }, getTarget());
      const level = result?.response?.data?.level;
      thinkingUnavailable = !level;
      if (level) {
        updateComposerThinking(level);
        return;
      }
      updateComposerThinking(state.thinkingLevel);
      onThinkingUnavailable?.();
    } catch (error) {
      showError(error);
    }
  });
  registerModelCycle(() => {
    void cycleComposerModel();
  });

  async function cycleComposerModel() {
    try {
      const result = await runtime.request({ type: "cycle_model" }, getTarget());
      const data = result?.response?.data;
      const model = data?.model;
      if (typeof model?.id === "string" && typeof model.provider === "string") {
        updateComposerModel({
          id: model.id,
          provider: model.provider,
          contextWindow: model.contextWindow,
        });
      }
      if (data?.thinkingLevel) updateComposerThinking(data.thinkingLevel);
    } catch (error) {
      showError(error);
    }
  }

  /** Opens the picker after the current click, which would otherwise close it again. */
  function openModelPicker() {
    setTimeout(() => {
      if (!state.availableLoaded) void loadAvailableModels();
      modelDropdownUi.open();
      /** @type {HTMLElement | null | undefined} */ (modelDropdownBtn)?.focus();
    }, 0);
  }

  return {
    updateComposerModel,
    updateComposerThinking,
    loadAvailableModels,
    loadScopedModelIds,
    openModelPicker,
    destroy() {
      modelDropdownBtn?.removeEventListener("click", onDropdownClick);
      document.removeEventListener("click", onDocumentClick);
      stopLocale?.();
    },
  };
}
