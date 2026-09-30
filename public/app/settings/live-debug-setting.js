// ABOUTME: Settings → General → Guard switch for "Live debugging by the model" (`ui.modelLiveDebug`, off by default).
// ABOUTME: The host reads it at startup and opens a WebView2 debugging port; a change needs a restart.

import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { row, toggle } from "../ui/settings-controls.js";

export const LIVE_DEBUG_KEY = "ui.modelLiveDebug";

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} PreferencesLike
 */

/** @returns {(() => Promise<unknown>) | null} */
export function tauriRelaunch() {
  const g = /** @type {{ __TAURI__?: { process?: { relaunch?: () => Promise<unknown> } } }} */ (
    globalThis
  );
  return g.__TAURI__?.process?.relaunch ?? null;
}

/** WebView2 is the only WebView with a debugging port SPOPI can open. */
export function liveDebugSupported(userAgent = globalThis.navigator?.userAgent ?? "") {
  return /Windows/.test(userAgent);
}

/**
 * @param {{
 *   preferences?: PreferencesLike | null,
 *   relaunch?: (() => Promise<unknown>) | null,
 *   supported?: boolean,
 *   register?: (load: () => Promise<unknown> | undefined) => void,
 * }} [options]
 * @returns {HTMLElement}
 */
export function liveDebugRow({
  preferences,
  relaunch = tauriRelaunch(),
  supported = liveDebugSupported(),
  register = (load) => {
    void load()?.catch(() => {});
  },
} = {}) {
  const restart = /** @type {HTMLButtonElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm settings-value-btn",
      id: "settings-live-debug-restart",
      text: t("settings.guard.liveDebug.restartNow"),
    })
  );
  restart.dataset.i18n = "settings.guard.liveDebug.restartNow";
  restart.hidden = true;
  restart.addEventListener("click", () => {
    void relaunch?.();
  });
  const note = /** @type {HTMLElement} */ (
    el("span", {
      class: "settings-live-debug-note",
      id: "settings-live-debug-note",
      role: "status",
      text: t("settings.guard.liveDebug.restart"),
    })
  );
  note.dataset.i18n = "settings.guard.liveDebug.restart";
  note.hidden = true;

  const control = toggle({
    id: "toggle-live-debug",
    checked: false,
    label: t("settings.guard.liveDebug.title"),
    onChange(next) {
      preferences?.set(LIVE_DEBUG_KEY, next).catch(() => {});
      note.hidden = false;
      restart.hidden = !relaunch;
    },
  });
  control.dataset.i18nAriaLabel = "settings.guard.liveDebug.title";
  if (!supported) {
    control.setAttribute("disabled", "");
    control.setAttribute("aria-disabled", "true");
  }
  register(() =>
    preferences?.get(LIVE_DEBUG_KEY).then((value) => {
      const on = value === true || value === "true";
      control.classList.toggle("on", on);
      control.setAttribute("aria-checked", on ? "true" : "false");
    }),
  );

  const descriptionKey = supported
    ? "settings.guard.liveDebug.description"
    : "settings.guard.liveDebug.windowsOnly";
  return /** @type {HTMLElement} */ (
    row({
      id: "setting-live-debug",
      label: "Live debugging by the model",
      labelKey: "settings.guard.liveDebug.title",
      description: t(descriptionKey),
      descriptionKey,
      control: el("span", { class: "settings-live-debug-control" }, [note, restart, control]),
    })
  );
}
