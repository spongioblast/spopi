// ABOUTME: Formats one review comment, or every draft as one review, and the comment card.
// ABOUTME: Sending and saving stay with the caller. This module only builds text and the form.

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
 * Every draft, grouped by file in the order they were added, as one prompt.
 * @param {Array<{ path?: string, hunkHeader?: string, original?: string[], proposed?: string[], note?: string }>} drafts
 */
export function formatReviewPackage(drafts) {
  /** @type {Map<string, typeof drafts>} */
  const byPath = new Map();
  for (const draft of drafts || []) {
    const path = draft.path || "";
    const group = byPath.get(path);
    if (group) group.push(draft);
    else byPath.set(path, [draft]);
  }
  const comments = drafts?.length || 0;
  const files = byPath.size;
  const commentWord = comments === 1 ? "comment" : "comments";
  const fileWord = files === 1 ? "file" : "files";
  const heading = `Code review: ${comments} ${commentWord} on ${files} ${fileWord}.`;
  const ask = "Address each one and say what you changed per number.";
  const lines = [`${heading} ${ask}`, ""];
  let number = 0;
  for (const [path, group] of byPath) {
    lines.push(`## ${path}`, "");
    for (const draft of group) {
      number += 1;
      const diff = [
        ...(draft.original || []).map((line) => `- ${line}`),
        ...(draft.proposed || []).map((line) => `+ ${line}`),
      ].join("\n");
      lines.push(`### ${number}. ${draft.hunkHeader || ""}`, "```diff", diff, "```");
      const note = String(draft.note || "").trim();
      if (note) lines.push(note);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   t: (key: string) => string,
 *   onAddToReview: (note: string) => void,
 *   onSendNow: (note: string) => void,
 *   onCancel: () => void,
 * }} actions
 */
export function mountReviewCommentDraft(host, { t, onAddToReview, onSendNow, onCancel }) {
  if (host.querySelector(".review-comment-draft")) return;
  const note = /** @type {HTMLTextAreaElement} */ (
    el("textarea", {
      class: "ui-textarea review-comment-note",
      placeholder: t("review.comments.placeholder"),
      onKeydown: (/** @type {KeyboardEvent} */ event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onAddToReview(note.value);
        }
      },
    })
  );
  host.append(
    el("div", { class: "review-comment-draft" }, [
      note,
      el("div", { class: "review-comment-actions" }, [
        el("button", {
          type: "button",
          class: "ui-button ui-button--xs ui-button--primary",
          text: t("review.comments.addToReview"),
          dataset: { i18n: "review.comments.addToReview" },
          onClick: () => onAddToReview(note.value),
        }),
        el("button", {
          type: "button",
          class: "ui-button ui-button--ghost ui-button--xs",
          text: t("review.comments.sendNow"),
          dataset: { i18n: "review.comments.sendNow" },
          onClick: () => onSendNow(note.value),
        }),
        el("button", {
          type: "button",
          class: "ui-button ui-button--ghost ui-button--xs",
          text: t("review.comments.cancel"),
          dataset: { i18n: "review.comments.cancel" },
          onClick: () => onCancel(),
        }),
      ]),
    ]),
  );
  note.focus();
}
