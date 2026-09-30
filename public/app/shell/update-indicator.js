// ABOUTME: Header pill that surfaces available extension package updates.
// ABOUTME: Consumes counts pushed by the package manager's update probe; opens Settings → Extensions on click.

import { onLocaleChange, t } from "../i18n/i18n.js";

/**
 * @param {{
 *   buttonEl?: Element | null,
 *   onOpen?: (() => void) | null,
 * }} [options]
 * @returns {{ setCount: (next: unknown) => void }}
 */
export function mountUpdateIndicator({ buttonEl, onOpen } = {}) {
  if (!buttonEl) return { setCount: () => {} };

  const button = buttonEl;
  let count = 0;

  function render() {
    button.classList.toggle("hidden", count <= 0);
    const tip = t("header.extensionUpdatesAvailable");
    if ("title" in button) {
      /** @type {{ title: string }} */ (button).title = tip;
    }
    button.setAttribute("aria-label", `${tip} (${count})`);
    const badge = button.querySelector(".update-indicator-count");
    if (badge) badge.textContent = String(count);
  }

  button.addEventListener("click", () => onOpen?.());
  onLocaleChange(render);
  render();

  return {
    // Push-only by design: the installed-packages page owns the actual update
    // probe, and this pill only mirrors its result.
    /** @param {unknown} next */
    setCount(next) {
      if (typeof next !== "number" || !Number.isFinite(next)) return;
      count = Math.max(0, Math.floor(next));
      render();
    },
  };
}
