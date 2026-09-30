// ABOUTME: After Pi's /undo the chat shows Pi's rewound branch, and one line marks the undone turn.
// ABOUTME: Redo on that line runs /redo; the line goes on the next prompt, a redo, or a session switch.

import { el } from "../ui/dom.js";

const UNDO_FILES = "Undo complete. Workspace restored to before that turn.";
const UNDO_CHAT = "Undo complete. Conversation rewound; current files kept.";

/**
 * pi-workspace-history reports a finished undo or redo with one of these notices,
 * sent after it has moved the session tree.
 * @param {unknown} message
 * @returns {{ kind: "undo", filesKept: boolean } | { kind: "redo" } | null}
 */
export function historyNotice(message) {
  const text = String(message ?? "").trim();
  if (text === UNDO_FILES) return { kind: "undo", filesKept: false };
  if (text === UNDO_CHAT) return { kind: "undo", filesKept: true };
  if (text.startsWith("Redo complete.")) return { kind: "redo" };
  return null;
}

/**
 * @param {{
 *   messages: HTMLElement | null,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   onRedo: () => void,
 * }} options
 */
export function createUndoMarker({ messages, t, onRedo }) {
  /** @type {HTMLElement | null} */
  let marker = null;

  function clear() {
    marker?.remove();
    marker = null;
  }

  // The next prompt starts a new branch; the undone turn is then only in the session tree.
  const watcher = new MutationObserver((records) => {
    if (!marker) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || node === marker) continue;
        if (node.matches(".message.user") || node.querySelector(".message.user")) {
          clear();
          return;
        }
      }
    }
  });
  if (messages) watcher.observe(messages, { childList: true, subtree: true });

  /**
   * The undone prompt was the one after the last prompt still in the chat.
   * @param {{ filesKept: boolean }} undo
   */
  function show({ filesKept }) {
    clear();
    if (!messages) return;
    const turn = messages.querySelectorAll(".message.user").length + 1;
    marker = /** @type {HTMLElement} */ (
      el("div", { class: "undo-marker", role: "status" }, [
        el("span", {
          class: "undo-marker-text",
          text: t(filesKept ? "chat.undone.chatOnly" : "chat.undone.withFiles", { n: turn }),
        }),
        el("button", {
          type: "button",
          class: "ui-button ui-button--ghost ui-button--xs undo-marker-redo",
          text: t("chat.undone.redo"),
          onClick: () => onRedo(),
        }),
      ])
    );
    messages.append(marker);
  }

  return { show, clear };
}
