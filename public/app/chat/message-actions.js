// ABOUTME: Fork and edit on a user message are session-store actions.
// ABOUTME: The message element stays on the action so the entry id can be resolved.

/** @type {(action: { type: string, entryId?: string | null, text?: string, messageEl?: Element | null }) => void} */
let emit = () => {};

/** @param {(action: { type: string, entryId?: string | null, text?: string, messageEl?: Element | null }) => void} dispatch */
export function setMessageActionDispatch(dispatch) {
  const previous = emit;
  emit = typeof dispatch === "function" ? dispatch : () => {};
  return () => {
    if (emit === dispatch) emit = previous;
  };
}

/** @param {{ entryId?: string | null, text?: string, messageEl?: Element | null }} detail */
export function forkMessage(detail) {
  emit({
    type: "message.fork",
    entryId: detail.entryId ?? null,
    text: detail.text ?? "",
    messageEl: detail.messageEl ?? null,
  });
}

/** @param {{ entryId?: string | null, text?: string, messageEl?: Element | null }} detail */
export function editMessage(detail) {
  emit({
    type: "message.edit",
    entryId: detail.entryId ?? null,
    text: detail.text ?? "",
    messageEl: detail.messageEl ?? null,
  });
}
