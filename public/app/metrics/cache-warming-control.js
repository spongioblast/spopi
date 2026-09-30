// ABOUTME: Cockpit control for Pi's cacheWarming setting.
// ABOUTME: Docked Cockpit uses segments; the floating overlay keeps the select. Both write set_cache_warming.

import { t } from "../i18n/i18n.js";

/** @type {HTMLSelectElement | null} */
let select = null;
/** @type {HTMLElement | null} */
let segmentRoot = null;
/** @type {HTMLButtonElement[]} */
let segmentButtons = [];
/** @type {string} */
let mode = "streaming";
/** @type {((op: string, params?: Record<string, unknown>) => Promise<{ ok?: boolean, data?: { mode?: string } }>) | null} */
let configCall = null;

const MODES = ["off", "streaming", "idle"];
const MODE_KEYS = {
  off: "metrics.cacheWarmingOff",
  streaming: "metrics.cacheWarmingStreaming",
  idle: "metrics.cacheWarmingIdle",
};
const TITLE_KEYS = {
  off: "metrics.cacheWarmingOffTitle",
  streaming: "metrics.cacheWarmingStreamingTitle",
  idle: "metrics.cacheWarmingIdleTitle",
};

/**
 * @param {string} value
 * @returns {value is "off" | "streaming" | "idle"}
 */
function isMode(value) {
  return value === "off" || value === "streaming" || value === "idle";
}

/** @param {string} next */
function applyMode(next) {
  mode = next;
  if (select) select.value = next;
  for (const button of segmentButtons) {
    button.setAttribute("aria-pressed", button.dataset.mode === next ? "true" : "false");
  }
}

/** @param {string} next */
function commitMode(next) {
  if (!isMode(next)) return;
  applyMode(next);
  void configCall?.("set_cache_warming", { mode });
}

/** @param {unknown} call */
export function bindCacheWarming(call) {
  configCall = typeof call === "function" ? /** @type {typeof configCall} */ (call) : null;
  return loadCacheWarming();
}

/** @param {keyof typeof MODE_KEYS} value */
function modeLabel(value) {
  return t(MODE_KEYS[value]);
}

/** @param {keyof typeof TITLE_KEYS} value */
function modeTitle(value) {
  return t(TITLE_KEYS[value]);
}

/** @returns {HTMLSelectElement} */
function cacheWarmingSelect() {
  if (select) return select;
  select = document.createElement("select");
  select.className = "metrics-cache-warming";
  select.setAttribute("aria-label", t("metrics.cacheWarming"));
  for (const value of MODES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = modeLabel(/** @type {keyof typeof MODE_KEYS} */ (value));
    select.append(option);
  }
  select.value = mode;
  select.addEventListener("change", () => {
    commitMode(select?.value || mode);
  });
  return select;
}

/** Labelled select for the floating overlay chip row. */
export function cacheWarmingControl() {
  const group = document.createElement("label");
  group.className = "metrics-control";
  const caption = document.createElement("span");
  caption.textContent = t("metrics.cacheWarming");
  group.append(caption, cacheWarmingSelect());
  return group;
}

/** Caption plus Off / Streaming / Idle for the docked controls row. */
export function cacheWarmingSegments() {
  if (segmentRoot) return segmentRoot;
  segmentRoot = document.createElement("div");
  segmentRoot.className = "metrics-cache-segments";
  const caption = document.createElement("span");
  caption.className = "metrics-control-caption";
  caption.textContent = t("metrics.cacheWarming");
  const group = document.createElement("div");
  group.className = "metrics-cache-segment-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("metrics.cacheWarming"));
  segmentButtons = MODES.map((value) => {
    const modeValue = /** @type {keyof typeof MODE_KEYS} */ (value);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--xs";
    button.dataset.mode = value;
    button.textContent = modeLabel(modeValue);
    button.title = modeTitle(modeValue);
    button.addEventListener("click", () => {
      commitMode(value);
    });
    return button;
  });
  group.append(...segmentButtons);
  segmentRoot.append(caption, group);
  applyMode(mode);
  return segmentRoot;
}

async function loadCacheWarming() {
  const response = await configCall?.("get_cache_warming", {});
  const next = response?.data?.mode;
  if (!isMode(String(next || ""))) return;
  applyMode(String(next));
}
