// ABOUTME: One 22px row above the composer while the agent runs: tool, elapsed, Steer, Stop.
// ABOUTME: Steer sends a follow-up; stop asks the runtime to abort.

/**
 * @param {HTMLElement | null | undefined} inputArea
 * @param {{
 *   t?: (key: string) => string,
 *   onSteer?: () => void,
 *   onStop?: () => void,
 * }} [options]
 */
export function mountLiveStrip(inputArea, { t = (key) => key, onSteer, onStop } = {}) {
  if (!inputArea) return null;
  /** @type {HTMLElement | null} */
  let strip = inputArea.querySelector(".live-strip");
  if (!strip) {
    strip = document.createElement("div");
    strip.className = "live-strip";
    strip.hidden = true;
    inputArea.prepend(strip);
  }
  const text = document.createElement("span");
  text.className = "live-text";
  const steer = document.createElement("button");
  steer.type = "button";
  steer.className = "ui-button ui-button--xs ui-button--ghost";
  steer.textContent = t("chat.steer") || "Steer";
  steer.addEventListener("click", () => onSteer?.());
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "ui-button ui-button--xs ui-button--ghost";
  stop.textContent = t("chat.stop") || "Stop";
  stop.addEventListener("click", () => onStop?.());
  strip.replaceChildren(text, steer, stop);
  return {
    strip,
    /** @param {string} [label] */
    show(label) {
      text.textContent = label || "";
      strip.hidden = false;
    },
    hide() {
      strip.hidden = true;
    },
  };
}
