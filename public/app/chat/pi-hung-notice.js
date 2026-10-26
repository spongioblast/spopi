// ABOUTME: The notice above the composer when Pi stopped answering: Restart Pi, or keep waiting.
// ABOUTME: It only draws; the watchdog decides when to show it and the caller does the restart.

/**
 * @param {HTMLElement | null | undefined} inputArea
 * @param {{
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   onRestart: () => Promise<unknown>,
 *   onWait: () => void,
 * }} deps
 */
export function mountPiHungNotice(inputArea, { t, onRestart, onWait }) {
  const notice = document.createElement("div");
  notice.className = "pi-hung-notice hidden";
  notice.setAttribute("role", "alert");
  const text = document.createElement("span");
  text.className = "pi-hung-notice-text";
  const restart = document.createElement("button");
  restart.type = "button";
  restart.className = "ui-button ui-button--sm ui-button--primary";
  restart.textContent = t("chat.piHung.restart");
  const wait = document.createElement("button");
  wait.type = "button";
  wait.className = "ui-button ui-button--sm ui-button--ghost";
  wait.textContent = t("chat.piHung.wait");
  notice.append(text, restart, wait);
  inputArea?.prepend(notice);

  restart.addEventListener("click", () => {
    restart.disabled = true;
    wait.disabled = true;
    text.textContent = t("chat.piHung.restarting");
    void onRestart().finally(() => {
      restart.disabled = false;
      wait.disabled = false;
    });
  });
  wait.addEventListener("click", () => {
    notice.classList.add("hidden");
    onWait();
  });

  return {
    /** @param {number} quietMs */
    show(quietMs) {
      text.textContent = t("chat.piHung.message", { seconds: Math.round(quietMs / 1000) });
      notice.classList.remove("hidden");
    },
    hide() {
      notice.classList.add("hidden");
    },
  };
}
