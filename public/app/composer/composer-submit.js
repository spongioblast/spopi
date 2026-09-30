// ABOUTME: Sends the composer text, attachments, and queue mode.
// ABOUTME: An empty composer does not start a turn.

/**
 * @param {object} options
 * @param {HTMLTextAreaElement | HTMLInputElement | null | undefined} options.input
 * @param {HTMLFormElement | null | undefined} options.form
 * @param {(detail: { altKey: boolean }) => void} options.onSubmit
 */
export function mountComposerSubmitHandling({ input, form, onSubmit }) {
  if (!input || !form) return { dispose() {} };
  const composerInput = input;
  const composerForm = form;

  let isComposingInput = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let compositionResetTimer = null;

  function clearCompositionReset() {
    if (compositionResetTimer === null) return;
    clearTimeout(compositionResetTimer);
    compositionResetTimer = null;
  }

  /** @param {KeyboardEvent | null} [event] */
  function isImeComposing(event = null) {
    return Boolean(event?.isComposing || event?.keyCode === 229 || isComposingInput);
  }

  function onCompositionStart() {
    clearCompositionReset();
    isComposingInput = true;
  }

  function onCompositionEnd() {
    clearCompositionReset();
    // WebKit fires compositionend before the confirming keydown, so
    // event.isComposing is already false by the time keydown runs. Delay the
    // reset so the flag survives that keydown and its default form submit.
    compositionResetTimer = setTimeout(() => {
      isComposingInput = false;
      compositionResetTimer = null;
    }, 0);
  }

  /** @param {Event} event */
  function onKeyDown(event) {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    if (isImeComposing(event)) return;
    event.preventDefault();
    onSubmit({ altKey: event.altKey });
  }

  /** @param {Event} event */
  function onFormSubmit(event) {
    event.preventDefault();
    if (isImeComposing()) return;
    onSubmit({ altKey: false });
  }

  composerInput.addEventListener("compositionstart", onCompositionStart);
  composerInput.addEventListener("compositionend", onCompositionEnd);
  composerInput.addEventListener("keydown", onKeyDown);
  composerForm.addEventListener("submit", onFormSubmit);

  return {
    dispose() {
      clearCompositionReset();
      composerInput.removeEventListener("compositionstart", onCompositionStart);
      composerInput.removeEventListener("compositionend", onCompositionEnd);
      composerInput.removeEventListener("keydown", onKeyDown);
      composerForm.removeEventListener("submit", onFormSubmit);
    },
  };
}
