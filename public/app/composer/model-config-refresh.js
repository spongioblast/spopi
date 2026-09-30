// ABOUTME: Re-selects the open session's model after its provider changed in models.json.
// ABOUTME: Pi keeps the old model object until set_model; a running reply finishes first.

/**
 * @typedef {{ providers?: string[], renamed?: { from: string, to: string } }} ModelConfigChange
 * @typedef {{
 *   response?: { data?: unknown },
 * }} RuntimeResult
 * @typedef {{
 *   model?: { provider?: string, id?: string, contextWindow?: number, reasoning?: boolean },
 *   thinkingLevel?: string,
 * }} RuntimeState
 */

/**
 * @param {ModelConfigChange | null} a
 * @param {ModelConfigChange} b
 * @returns {ModelConfigChange}
 */
function mergeChanges(a, b) {
  return {
    providers: [...new Set([...(a?.providers || []), ...(b.providers || [])])],
    renamed: b.renamed || a?.renamed,
  };
}

/**
 * @param {{
 *   runtime: { request: (payload: unknown, target: unknown, options?: unknown) => Promise<RuntimeResult> },
 *   config: { call: (op: string, params?: Record<string, unknown>) => Promise<{ ok?: boolean, data?: { level?: string | null } } | null | undefined> },
 *   getTarget: () => unknown,
 *   getSelection: () => { provider?: string | null, modelId?: string | null },
 *   isStreaming: () => boolean,
 *   updateComposerModel: (model: { provider: string, id: string, contextWindow?: number }) => void,
 *   updateComposerThinking: (level: string) => void,
 *   notify?: (notice: Record<string, unknown>) => void,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   randomId: () => string,
 * }} deps
 */
export function createModelConfigRefresh(deps) {
  /** @type {ModelConfigChange | null} */
  let pending = null;

  /** @param {ModelConfigChange} change */
  function affectsSelection(change) {
    const { provider } = deps.getSelection();
    if (!provider) return false;
    return change.renamed?.from === provider || Boolean(change.providers?.includes(provider));
  }

  /** @param {ModelConfigChange} change */
  async function apply(change) {
    const selection = deps.getSelection();
    const modelId = selection.modelId;
    let provider = selection.provider;
    if (!provider || !modelId || !affectsSelection(change)) return false;
    if (change.renamed?.from === provider) provider = change.renamed.to;
    const target = deps.getTarget();
    try {
      const selected = await deps.runtime.request(
        { type: "set_model", provider, modelId },
        target,
        { idempotencyKey: deps.randomId() },
      );
      if (selected?.response?.data === false) throw new Error(`${provider}/${modelId}`);
    } catch {
      deps.notify?.({
        type: "warning",
        title: deps.t("composer.modelConfigMissing", { model: `${provider}/${modelId}` }),
      });
      return false;
    }
    const saved = await deps.config
      .call("get_model_thinking_level", { provider, modelId })
      .catch(() => null);
    const level = saved?.data?.level;
    if (level) {
      await deps.runtime
        .request({ type: "set_thinking_level", level }, target, {
          idempotencyKey: deps.randomId(),
        })
        .catch(() => undefined);
    }
    const state = /** @type {RuntimeState | undefined} */ (
      (await deps.runtime.request({ type: "get_state" }, target).catch(() => null))?.response?.data
    );
    const model = state?.model;
    deps.updateComposerModel({
      provider: model?.provider || provider,
      id: model?.id || modelId,
      contextWindow: model?.contextWindow,
    });
    if (state?.thinkingLevel) deps.updateComposerThinking(state.thinkingLevel);
    return true;
  }

  /**
   * Called after Settings wrote models.json; without a provider list nothing about models changed.
   * @param {ModelConfigChange} [change]
   */
  function onModelConfigurationChanged(change) {
    if (!change?.providers?.length && !change?.renamed) return;
    if (!affectsSelection(change)) return;
    if (deps.isStreaming()) {
      const first = pending === null;
      pending = mergeChanges(pending, change);
      if (first) {
        deps.notify?.({ type: "info", title: deps.t("composer.modelConfigAfterReply") });
      }
      return;
    }
    void apply(change);
  }

  /** The foreground reply settled; apply what waited for it. */
  function onSettled() {
    if (!pending) return;
    const change = pending;
    pending = null;
    void apply(change);
  }

  return { onModelConfigurationChanged, onSettled, apply };
}
