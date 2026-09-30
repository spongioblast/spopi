// ABOUTME: Formats a review comment and the draft card under a hunk.
// ABOUTME: Sending stays with the caller; this module only builds the text and the form.

import { el } from "../../ui/dom.js";

/**
 * @param {{ path?: string, original?: string[], proposed?: string[], note?: string }} comment
 */
export function formatReviewComment({ path = "", original = [], proposed = [], note = "" } = {}) {
  const diff = [
    ...original.map((line) => `- ${line}`),
    ...proposed.map((line) => `+ ${line}`),
  ].join("\n");
  const body = note.trim() ? `\n\n${note.trim()}` : "";
  return `Review comment on \`${path}\`:\n\n\`\`\`diff\n${diff}\n\`\`\`${body}`;
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   t: (key: string) => string,
 *   onAdd: (note: string) => void,
 *   onSend: (note: string, queue: boolean) => void,
 * }} actions
 */
export function mountReviewCommentDraft(host, { t, onAdd, onSend }) {
  if (host.querySelector(".review-comment-draft")) return;
  const note = /** @type {HTMLTextAreaElement} */ (
    el("textarea", {
      class: "ui-textarea review-comment-note",
      placeholder: t("review.comments.placeholder"),
    })
  );
  const draft = el("div", { class: "review-comment-draft" }, [
    note,
    el("div", { class: "review-comment-actions" }, [
      el("button", {
        type: "button",
        class: "ui-button ui-button--xs ui-button--primary",
        text: t("review.comments.send"),
        dataset: { i18n: "review.comments.send" },
        onClick: () => onSend(note.value, false),
      }),
      el("button", {
        type: "button",
        class: "ui-button ui-button--ghost ui-button--xs",
        text: t("review.comments.queue"),
        dataset: { i18n: "review.comments.queue" },
        onClick: () => onSend(note.value, true),
      }),
      el("button", {
        type: "button",
        class: "ui-button ui-button--ghost ui-button--xs review-comment-add",
        text: t("review.comments.add"),
        dataset: { i18n: "review.comments.add" },
        onClick: () => onAdd(note.value),
      }),
    ]),
  ]);
  host.append(draft);
  note.focus();
}
