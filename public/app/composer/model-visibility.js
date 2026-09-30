// ABOUTME: Catalog visibility filter, context-window lookup, and thinking-level events.
// ABOUTME: Never changes settings.json defaults.

/**
 * @typedef {{ provider: string, id: string, contextWindow?: number }} ComposerModel
 * @typedef {{
 *   call: (op: string) => Promise<{
 *     ok?: boolean,
 *     error?: string,
 *     data?: {
 *       providers?: Array<{
 *         provider?: string,
 *         models?: Array<{
 *           available?: boolean,
 *           visible?: boolean,
 *           provider?: string,
 *           id?: string,
 *         }>,
 *       }>,
 *     },
 *   }>,
 * }} ModelConfigClient
 */

/**
 * @param {ComposerModel[]} models
 * @param {ModelConfigClient} config
 * @returns {Promise<ComposerModel[]>}
 */
export async function applyConfiguredModelVisibility(models, config) {
  try {
    const catalog = await config.call("list_model_catalog");
    if (!catalog?.ok) throw new Error(catalog?.error || "Failed to load model catalog");
    const visibleKeys = new Set();
    for (const provider of catalog.data?.providers ?? []) {
      for (const model of provider.models ?? []) {
        if (model.available && model.visible === true) {
          visibleKeys.add(`${model.provider || provider.provider}/${model.id}`);
        }
      }
    }
    return models.filter((model) => visibleKeys.has(`${model.provider}/${model.id}`));
  } catch (error) {
    console.warn("[spopi] Failed to load configured model visibility:", error);
    return [];
  }
}

/**
 * @param {ComposerModel[] | null | undefined} models
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} modelId
 * @returns {number}
 */
export function findModelContextWindow(models, provider, modelId) {
  if (!provider || !modelId) return 0;
  const model = (models || []).find(
    (candidate) => candidate.provider === provider && candidate.id === modelId,
  );
  return Number(model?.contextWindow) || 0;
}

/**
 * Apply a Pi `thinking_level_changed` event to the composer chip.
 *
 * @param {{ type?: string, level?: unknown } | null | undefined} event
 * @param {(level: unknown) => void} update
 */
export function applyVisibilityThinkingLevel(event, update) {
  if (event?.type !== "thinking_level_changed") return;
  if (typeof event.level === "string" && event.level) update(event.level);
}
