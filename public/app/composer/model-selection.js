// ABOUTME: Compares provider-scoped model identities for composer selection state.
// ABOUTME: Keeps duplicate model IDs from different providers distinguishable.

/**
 * @param {{ provider?: string, id?: string } | null | undefined} model
 * @param {{ provider?: string, modelId?: string } | null | undefined} selection
 */
export function isSelectedModel(model, selection) {
  return Boolean(
    model?.provider &&
      model?.id &&
      model.provider === selection?.provider &&
      model.id === selection?.modelId,
  );
}

/**
 * Split visibility-filtered models into the starred (scoped) section and the
 * remaining enabled models. Scoped order follows the stored enabledModels
 * order; ids that no longer resolve to a visible model are dropped so hidden
 * or unavailable stars never render.
 * @param {Array<{ provider: string, id: string }> | null | undefined} models
 * @param {string[] | null | undefined} scopedModelIds
 */
export function splitModelsByScope(models, scopedModelIds) {
  if (!Array.isArray(models)) return { scoped: [], remaining: [] };
  const byId = new Map(models.map((model) => [`${model.provider}/${model.id}`, model]));
  const scoped = (Array.isArray(scopedModelIds) ? scopedModelIds : [])
    .map((id) => byId.get(id))
    .filter(
      /**
       * @param {{ provider: string, id: string } | undefined} model
       * @returns {model is { provider: string, id: string }}
       */
      (model) => Boolean(model),
    );
  const scopedIds = new Set(scoped.map((model) => `${model.provider}/${model.id}`));
  return {
    scoped,
    remaining: models.filter((model) => !scopedIds.has(`${model.provider}/${model.id}`)),
  };
}
