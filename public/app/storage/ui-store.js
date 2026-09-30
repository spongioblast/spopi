// ABOUTME: In-memory ui.* preference cache with write-through to the host preference DB.
// ABOUTME: Callers use getItem/setItem; the browser Storage API stays out of this module.

/** @type {Map<string, string>} */
const memory = new Map();

/**
 * @typedef {{
 *   set?: (key: string, value: unknown) => Promise<unknown> | void,
 *   remove?: (key: string) => Promise<unknown> | void,
 * }} UiPreferenceGateway
 */

/** @type {UiPreferenceGateway | null} */
let preferences = null;

/** Attach the preference gateway. Later setItem calls persist through it.
 * @param {UiPreferenceGateway | null | undefined} next
 */
export function createUiStoreBinding(next) {
  preferences = next || null;
}

/**
 * Load every ui.* value the host already has. Strings stay strings; booleans
 * and numbers become their String form; objects become JSON text.
 * @param {{ list?: (prefix: string) => Promise<Record<string, unknown>> } | null | undefined} gateway
 */
export async function hydrateUiStore(gateway) {
  const entries = await gateway?.list?.("ui.").catch(() => ({}));
  if (!entries || typeof entries !== "object") return;
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "string") memory.set(key, value);
    else if (typeof value === "boolean" || typeof value === "number")
      memory.set(key, String(value));
    else if (value != null) memory.set(key, JSON.stringify(value));
  }
}

/** Drop cached preferences. Tests use this between cases. */
export function resetUiStore() {
  memory.clear();
}

export const uiStore = {
  /** @param {string} key */
  getItem(key) {
    return memory.has(key) ? (memory.get(key) ?? null) : null;
  },
  /**
   * @param {string} key
   * @param {unknown} value
   */
  setItem(key, value) {
    const text = String(value);
    memory.set(key, text);
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    preferences?.set?.(key, parsed)?.catch?.(() => {});
  },
  /** @param {string} key */
  removeItem(key) {
    memory.delete(key);
    preferences?.remove?.(key)?.catch?.(() => {});
  },
};
