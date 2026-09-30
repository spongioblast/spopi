// ABOUTME: Holds back a prompt while the model picker has no usable model.
// ABOUTME: Send dims, and a submitted prompt keeps its draft and says where to pick one.

/**
 * `none`: the picker offers no model. `unselected`: it offers some, but not the selection.
 * @typedef {"ready" | "none" | "unselected"} ModelStatus
 *
 * @param {{
 *   sendButton?: HTMLElement | null,
 *   t: (key: string) => string,
 *   notify: (notice: {
 *     type: string,
 *     title: string,
 *     message: string,
 *     action: { label: string, onClick: () => void },
 *   }) => { dismiss?: () => void } | unknown,
 *   openModelPicker: () => void,
 *   openModelSettings: () => void,
 * }} options
 */
export function createSendModelGate({ sendButton, t, notify, openModelPicker, openModelSettings }) {
  /** @type {ModelStatus} */
  let status = "ready";
  /** @type {(() => void) | null} */
  let dismissNote = null;

  function closeNote() {
    dismissNote?.();
    dismissNote = null;
  }

  function renderButton() {
    if (!sendButton) return;
    const blocked = status !== "ready";
    const key = blocked ? "composer.sendNeedsModel" : "input.send";
    sendButton.classList.toggle("is-model-blocked", blocked);
    if (blocked) sendButton.setAttribute("aria-disabled", "true");
    else sendButton.removeAttribute("aria-disabled");
    sendButton.dataset.i18nTitle = key;
    sendButton.dataset.i18nAriaLabel = key;
    sendButton.title = t(key);
    sendButton.setAttribute("aria-label", t(key));
  }

  return {
    /** @param {ModelStatus} next */
    setStatus(next) {
      if (next === status) return;
      status = next;
      if (status === "ready") closeNote();
      renderButton();
    },
    /** @returns {boolean} true when a prompt may go to Pi; otherwise shows the note. */
    allowPrompt() {
      if (status === "ready") return true;
      closeNote();
      const none = status === "none";
      const handle = notify({
        type: "info",
        title: t("composer.sendNeedsModel"),
        message: t(none ? "composer.sendNoModelHint" : "composer.sendNeedsModelHint"),
        action: none
          ? { label: t("composer.openModelSettings"), onClick: openModelSettings }
          : { label: t("composer.openModelPicker"), onClick: openModelPicker },
      });
      const dismiss = /** @type {{ dismiss?: () => void } | null} */ (handle)?.dismiss;
      dismissNote = typeof dismiss === "function" ? dismiss : null;
      return false;
    },
  };
}
