// ABOUTME: Persists the last manually selected composer model in the ui.* store.
// ABOUTME: New (empty) sessions inherit this model instead of pi's built-in default.

import { uiStore } from "../storage/ui-store.js";

const STORAGE_KEY = "ui.composer.lastModel";

/** @typedef {Pick<typeof uiStore, "getItem" | "setItem">} LastModelStorage */

/**
 * @param {LastModelStorage | null | undefined} storage
 * @returns {LastModelStorage | typeof uiStore}
 */
function safeStorage(storage) {
  return storage || uiStore;
}

/**
 * Read the last manually selected model, or null when nothing valid is stored.
 * Returns a `{ provider, modelId }` pair to mirror the RPC/profile shape.
 * @param {LastModelStorage | null | undefined} [storage]
 * @returns {{ provider: string, modelId: string } | null}
 */
export function getLastModel(storage = null) {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const provider = typeof parsed?.provider === "string" ? parsed.provider.trim() : "";
    const modelId = typeof parsed?.modelId === "string" ? parsed.modelId.trim() : "";
    if (!provider || !modelId) return null;
    return { provider, modelId };
  } catch {
    return null;
  }
}

/**
 * Persist a model as the inheritance default for future new sessions. Accepts
 * either an available-model object (`{ provider, id }`) or a profile-shaped
 * pair (`{ provider, modelId }`). Invalid input is ignored.
 * @param {{ provider?: string, id?: string, modelId?: string } | null | undefined} model
 * @param {LastModelStorage | null | undefined} [storage]
 */
export function setLastModel(model, storage = null) {
  const store = safeStorage(storage);
  if (!store) return;
  const provider = typeof model?.provider === "string" ? model.provider.trim() : "";
  const rawId =
    typeof model?.id === "string"
      ? model.id
      : typeof model?.modelId === "string"
        ? model.modelId
        : "";
  const modelId = rawId.trim();
  if (!provider || !modelId) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ provider, modelId }));
  } catch {
    // Storage full or unavailable — inheritance silently degrades to pi's default.
  }
}
