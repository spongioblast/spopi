// ABOUTME: The thinking effort slider in Settings → General: builds it, saves the default, applies it live.
// ABOUTME: The default goes to settings.json; the open session changes only when its model offers the level.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { segmentedLevel } from "../ui/settings-controls.js";
import { randomId } from "../utils/random-id.js";

/**
 * @typedef {import("./general-settings.js").ConfigGatewayLike} ConfigGatewayLike
 * @typedef {import("./general-settings.js").RuntimeLike} RuntimeLike
 */

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];

export function thinkingEffortControl() {
  return segmentedLevel({
    id: "thinking-effort",
    nameId: "thinking-effort-name",
    markerId: "thinking-effort-marker",
    stepsId: "thinking-effort-steps",
    radioName: "thinking-effort-level",
    label: "Thinking effort",
    labelKey: "settings.thinkingEffort",
    value: "off",
    ends: {
      start: "Faster",
      startKey: "settings.thinkingFaster",
      current: "off",
      currentKey: "settings.thinkingLevels.off",
      end: "Smarter",
      endKey: "settings.thinkingSmarter",
    },
    levels: THINKING_LEVELS.map((level) => ({
      value: level,
      label: level,
      key: `settings.thinkingLevels.${level}`,
    })),
  });
}

/**
 * @param {string} level
 * @returns {string}
 */
function formatThinkingLevelLabel(level) {
  const key = `settings.thinkingLevels.${level}`;
  const label = t(key);
  return label === key ? level : label;
}

/**
 * @param {unknown} response
 * @returns {unknown}
 */
function runtimeResponseData(response) {
  if (!response || typeof response !== "object") return response;
  const record = /** @type {Record<string, unknown>} */ (response);
  const nested = record.response;
  const nestedData =
    nested && typeof nested === "object"
      ? /** @type {Record<string, unknown>} */ (nested).data
      : undefined;
  return nestedData ?? record.data ?? response;
}

/**
 * @param {{
 *   runtime?: RuntimeLike | null,
 *   getTarget?: (() => unknown) | null,
 *   configGateway?: ConfigGatewayLike | null,
 *   onError?: ((error: unknown) => void) | null,
 *   onRuntimeLevelChanged?: ((level: string, target: unknown) => void) | null,
 * }} [options]
 */
export function mountThinkingEffortControl({
  runtime,
  getTarget,
  configGateway,
  onError,
  onRuntimeLevelChanged,
} = {}) {
  const radioGroup = /** @type {HTMLElement | null} */ (document.querySelector("#thinking-effort"));
  const levelName = /** @type {HTMLElement | null} */ (
    document.querySelector("#thinking-effort-name")
  );
  const thumb = /** @type {HTMLElement | null} */ (
    document.querySelector("#thinking-effort-marker")
  );
  if (!radioGroup) return;
  /** @type {HTMLInputElement[]} */
  const buttons = Array.from(radioGroup.querySelectorAll(".thinking-effort-dot")).flatMap(
    (node) => {
      if (!("checked" in node) || !("dataset" in node) || !("focus" in node)) return [];
      return [/** @type {HTMLInputElement} */ (node)];
    },
  );
  const levels = /** @type {string[]} */ (buttons.map((btn) => btn.dataset.level).filter(Boolean));
  let hasUserChangedLevel = false;

  /**
   * @param {string} level
   */
  function updateUI(level) {
    const index = levels.indexOf(level);
    if (index === -1) return;
    for (let i = 0; i < buttons.length; i++) {
      const isActive = i === index;
      buttons[i].checked = isActive;
      buttons[i].classList.toggle("active", isActive);
    }
    if (levelName) {
      levelName.dataset.thinkingLevel = level;
      levelName.textContent = formatThinkingLevelLabel(level);
    }
    if (thumb && buttons[index]) {
      const button = buttons[index];
      thumb.style.left = `${button.offsetLeft + (button.offsetWidth - thumb.offsetWidth) / 2}px`;
    }
  }

  /**
   * @param {string} level
   */
  async function setThinkingLevel(level) {
    hasUserChangedLevel = true;
    try {
      if (configGateway) {
        const response = await configGateway.call("set_default_thinking_level", {
          level,
          scope: "global",
        });
        if (!response?.ok) throw new Error(response?.error || "Failed to save thinking level");
      }
      updateUI(level);
    } catch (error) {
      onError?.(error);
      return;
    }
    const target = getTarget?.();
    if (!(runtime && target)) return;
    try {
      const availableResponse = await runtime.request(
        { type: "get_available_thinking_levels" },
        target,
      );
      const availableLevelsRaw = runtimeResponseData(availableResponse);
      const availableLevels =
        availableLevelsRaw && typeof availableLevelsRaw === "object"
          ? /** @type {Record<string, unknown>} */ (availableLevelsRaw).levels
          : undefined;
      if (Array.isArray(availableLevels) && availableLevels.includes(level)) {
        await runtime.request({ type: "set_thinking_level", level }, target, {
          idempotencyKey: randomId(),
        });
        onRuntimeLevelChanged?.(level, target);
      }
    } catch (error) {
      console.warn(
        "[spopi] Saved default thinking level but could not apply it to session:",
        error,
      );
    }
  }

  async function loadDefaultThinkingLevel() {
    if (!configGateway) return;
    try {
      const response = await configGateway.call("get_default_thinking_level", { scope: "global" });
      const level = response?.data?.level;
      if (!hasUserChangedLevel && response?.ok && level) updateUI(String(level));
    } catch (error) {
      onError?.(error);
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const level = button.dataset.level;
      if (level) setThinkingLevel(level).catch((/** @type {unknown} */ error) => onError?.(error));
    });
  }
  radioGroup.addEventListener("keydown", (/** @type {KeyboardEvent} */ event) => {
    const currentIndex = buttons.findIndex((btn) => btn.checked);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else return;
    const nextLevel = levels[nextIndex];
    if (nextLevel) {
      buttons[nextIndex].focus();
      setThinkingLevel(nextLevel).catch((/** @type {unknown} */ error) => onError?.(error));
    }
  });
  const unsubscribeLocale = onLocaleChange(() => {
    const currentLevel =
      levelName?.dataset.thinkingLevel || levels.find((_, i) => buttons[i]?.checked);
    if (currentLevel) updateUI(currentLevel);
  });
  void loadDefaultThinkingLevel();
  return { updateUI, destroy: unsubscribeLocale };
}
