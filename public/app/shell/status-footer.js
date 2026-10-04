// ABOUTME: Paints extension setStatus keys as chips in the dock status row.
// ABOUTME: Composer and Problems keys are omitted; pi-lens-lsp goes to Problems.

/** The composer already shows this key as the guard chip. */
const COMPOSER_OWNED = new Set(["pi-permission-system"]);
/** The Problems header owns the language-server line. */
const PROBLEMS_OWNED = new Set(["pi-lens-lsp"]);

/** @type {HTMLElement | null} */
let host = null;
/** @type {(() => { commands?: Array<{ sourceInfo?: { source?: string, path?: string } }> } | null) | null} */
let catalogLookup = null;

/**
 * @param {(() => { commands?: Array<{ sourceInfo?: { source?: string, path?: string } }> } | null) | null | undefined} getCatalog
 */
export function setStatusCatalog(getCatalog) {
  catalogLookup = typeof getCatalog === "function" ? getCatalog : null;
}

/**
 * @param {string} key
 * @returns {string}
 */
function packageFor(key) {
  const commands = catalogLookup?.()?.commands || [];
  const hit = commands.find((command) => {
    const source = `${command.sourceInfo?.source || ""} ${command.sourceInfo?.path || ""}`;
    return source.includes(key);
  });
  const source = hit?.sourceInfo?.source || "";
  return source.startsWith("npm:") ? source.slice(4) : source;
}
/** @type {Record<string, string>} */
let latest = {};
/** @type {((text: string) => void) | null} */
let problemsLanguageStatus = null;

/**
 * @param {((text: string) => void) | null | undefined} listener
 */
export function registerProblemsLanguageStatus(listener) {
  problemsLanguageStatus = typeof listener === "function" ? listener : null;
  problemsLanguageStatus?.(typeof latest["pi-lens-lsp"] === "string" ? latest["pi-lens-lsp"] : "");
  return () => {
    if (problemsLanguageStatus === listener) problemsLanguageStatus = null;
  };
}

/**
 * @param {HTMLElement | null | undefined} root
 */
export function registerStatusFooter(root) {
  if (!root || !("querySelector" in root)) return () => {};
  host = root;
  paintStatusFooter(latest);
  return () => {
    if (host === root) host = null;
  };
}

/**
 * @param {Record<string, string> | null | undefined} keys
 */
export function paintStatusFooter(keys) {
  latest = keys && typeof keys === "object" ? { ...keys } : {};
  problemsLanguageStatus?.(typeof latest["pi-lens-lsp"] === "string" ? latest["pi-lens-lsp"] : "");
  const root = host;
  if (!root || !("querySelector" in root)) return;
  let slot = root.querySelector(".extension-status");
  if (!slot || !("replaceChildren" in slot)) {
    slot = document.createElement("span");
    slot.className = "extension-status";
    root.prepend(slot);
  }
  slot.replaceChildren();
  for (const [key, text] of Object.entries(keys || {})) {
    if (!text || COMPOSER_OWNED.has(key) || PROBLEMS_OWNED.has(key)) continue;
    const chip = document.createElement("span");
    chip.className = "extension-status-chip";
    chip.dataset.statusKey = key;
    chip.textContent = text;
    const pkg = packageFor(key);
    chip.title = pkg ? `${key} · ${pkg}` : key;
    slot.append(chip);
  }
}
