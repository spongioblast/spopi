// ABOUTME: Makes the composer show the model and thinking level Pi actually runs.
// ABOUTME: An empty session first switches Pi to the last picked model; a failed switch is shown.

import { getLastModel } from "./last-model-store.js";

/**
 * @typedef {{ provider: string, id: string, contextWindow?: number }} PiModel
 * @typedef {{ provider: string, modelId: string }} LastModel
 * @typedef {{
 *   request: (
 *     cmd: object,
 *     target?: unknown,
 *     opts?: object,
 *   ) => Promise<{ response?: { data?: unknown } } | null | undefined>,
 * }} RuntimeClient
 */

/**
 * @param {unknown} model
 * @returns {PiModel | null}
 */
function piModelOf(model) {
  const candidate =
    /** @type {{ provider?: unknown, id?: unknown, contextWindow?: unknown } | null} */ (
      model && typeof model === "object" ? model : null
    );
  if (typeof candidate?.provider !== "string" || typeof candidate.id !== "string") return null;
  if (!candidate.provider || !candidate.id) return null;
  const contextWindow = Number(candidate.contextWindow) || undefined;
  return { provider: candidate.provider, id: candidate.id, contextWindow };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {{
 *   runtime: RuntimeClient,
 *   config: { call: (op: string, params?: Record<string, unknown>) => Promise<unknown> },
 *   getTarget: () => { sessionId?: string } | null | undefined,
 *   randomId: () => string,
 *   updateComposerModel: (model: PiModel | null) => void,
 *   updateComposerThinking: (level: string) => void,
 *   notify: (notice: {
 *     type: string,
 *     title: string,
 *     message: string,
 *     action: { label: string, onClick: () => void },
 *   }) => unknown,
 *   openModelPicker: () => void,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 * }} deps
 */
export function createComposerPiSync(deps) {
  let latest = 0;

  /**
   * @param {unknown} target
   * @param {LastModel} model
   * @returns {Promise<string | null>} Pi's error, or null once Pi runs the model.
   */
  async function switchTo(target, model) {
    try {
      const result = await deps.runtime.request(
        { type: "set_model", provider: model.provider, modelId: model.modelId },
        target,
        { idempotencyKey: deps.randomId() },
      );
      return result?.response?.data === false ? `${model.provider}/${model.modelId}` : null;
    } catch (error) {
      return errorText(error);
    }
  }

  /**
   * Pi fills its model list in the background, so a Pi process that just started may not
   * list the model yet. Reloading the list once covers that before the failure is shown.
   *
   * @param {{ piModel?: unknown, inheritLastModel?: boolean }} [options]
   */
  async function sync({ piModel = null, inheritLastModel = false } = {}) {
    const run = ++latest;
    const target = deps.getTarget();
    const current = piModelOf(piModel);
    const last = inheritLastModel ? getLastModel() : null;
    /** @type {string | null} */
    let failure = null;
    if (last && !(current?.provider === last.provider && current.id === last.modelId)) {
      failure = await switchTo(target, last);
      if (failure) {
        await deps.config.call("refresh_models").catch(() => null);
        failure = await switchTo(target, last);
      }
    }
    const state = /** @type {{ model?: unknown, thinkingLevel?: unknown } | null | undefined} */ (
      await deps.runtime
        .request({ type: "get_state" }, target)
        .then((result) => result?.response?.data)
        .catch(() => null)
    );
    if (run !== latest || deps.getTarget()?.sessionId !== target?.sessionId) return;
    if (state && typeof state === "object") {
      deps.updateComposerModel(piModelOf(state.model));
      if (typeof state.thinkingLevel === "string" && state.thinkingLevel) {
        deps.updateComposerThinking(state.thinkingLevel);
      }
    }
    if (failure && last) {
      deps.notify({
        type: "warning",
        title: deps.t("composer.modelSwitchFailed", { model: `${last.provider}/${last.modelId}` }),
        message: failure,
        action: { label: deps.t("composer.openModelPicker"), onClick: deps.openModelPicker },
      });
    }
  }

  return { sync };
}
