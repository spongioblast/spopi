// ABOUTME: Renders one quiet turn: header, thinking, one work row, the answer, and files.
// ABOUTME: It reads the transcript store and does not send commands except Review.

import { tn } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { formatTurnDuration, workRowLabel } from "./transcript-turns.js";

/**
 * @typedef {import("./transcript-turns.js").Turn} Turn
 * @typedef {{ id?: string, role?: string, content?: unknown }} TurnMessage
 */

/**
 * @param {HTMLElement} root
 * @param {{
 *   turn: Turn,
 *   messages?: TurnMessage[],
 *   t?: (key: string, params?: Record<string, unknown>) => string,
 *   onReview?: (turn: Turn) => void,
 *   showReview?: boolean,
 * }} options
 */
export function mountTurnBlock(
  root,
  { turn, messages = [], t = () => "", onReview, showReview = true },
) {
  const translate = t;
  const duration = turn.endedAt != null ? formatTurnDuration(turn.endedAt - turn.startedAt) : "";
  const model = turn.model?.id || "";
  const tokenLabel = tokenText(turn, translate);
  const header = el("div", { class: "turn-block-header" }, [
    el("span", { class: "turn-block-model", text: model }),
    duration ? el("span", { class: "turn-block-duration", text: duration }) : null,
    tokenLabel ? el("span", { class: "turn-block-tokens", text: tokenLabel }) : null,
    turn.cacheHit ? el("span", { class: "turn-block-cache", text: turn.cacheHit }) : null,
  ]);
  const thought = thoughtLabel(turn, translate);
  const thinking = turn.thinking?.text
    ? el("details", { class: "turn-block-thinking" }, [
        el("summary", { text: thought }),
        el("pre", { class: "turn-block-thinking-text", text: turn.thinking.text }),
      ])
    : null;
  const work =
    turn.work?.steps?.length > 0
      ? el("details", { class: "turn-block-work" }, [
          el("summary", { class: "turn-block-work-row", text: workRowLabel(turn, translate) }),
          el(
            "ol",
            { class: "turn-block-steps" },
            turn.work.steps.map((step) => el("li", { text: `${step.kind} ${step.name}` })),
          ),
        ])
      : null;
  const answer = answerText(messages, turn.answerId);
  const answerNode = answer ? el("div", { class: "turn-block-answer", text: answer }) : null;
  const changed = fileTotals(turn);
  const files =
    showReview && changed.count > 0
      ? el("div", { class: "turn-block-files" }, [
          el("button", {
            type: "button",
            class: "turn-block-review",
            dataset: { reviewKey: reviewKey(turn) },
            text: reviewLabel(translate, changed),
            onClick: () => onReview?.(turn),
          }),
        ])
      : null;
  const notices = (turn.notices || []).map((notice) =>
    el("p", { class: "turn-block-notice", text: noticeText(notice, translate) }),
  );
  root.classList.add("turn-block");
  root.replaceChildren();
  for (const node of [header, thinking, work, answerNode, files, ...notices]) {
    if (node) root.append(node);
  }
  return { root };
}

/**
 * @param {Turn["notices"][number]} notice
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
function noticeText(notice, t) {
  if (notice.kind === "compaction") {
    if (notice.status === "running") return t("chat.notice.compacting");
    if (notice.status === "failed") {
      return notice.text
        ? t("chat.notice.compactionFailedWith", { error: notice.text })
        : t("chat.notice.compactionFailed");
    }
    return t("chat.notice.compacted");
  }
  if (notice.kind === "summarization-retry") {
    return notice.source
      ? t("chat.notice.summaryRetrying", { source: notice.source })
      : t("chat.notice.summaryRetryIn", {
          attempt: notice.attempt ?? 1,
          seconds: notice.seconds ?? 0,
        });
  }
  if (notice.kind === "error") return notice.text || t("chat.notice.extensionFailed");
  return notice.text || "";
}

/**
 * @param {Turn} turn
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
function tokenText(turn, t) {
  if (!turn.tokens) return "";
  const value = t("chat.turn.tokens", { in: turn.tokens.in, out: turn.tokens.out });
  return value && value !== "chat.turn.tokens"
    ? value
    : `${turn.tokens.in} in / ${turn.tokens.out} out`;
}

/**
 * @param {Turn} turn
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
function thoughtLabel(turn, t) {
  const duration = formatTurnDuration(turn.thinking?.durationMs || 0);
  const value = t("chat.turn.thought", { duration });
  return value && value !== "chat.turn.thought" ? value : `Thought for ${duration}`;
}

/**
 * @param {TurnMessage[]} messages
 * @param {string | null} answerId
 */
function answerText(messages, answerId) {
  const message = messages.find((entry) => entry && entry.id === answerId);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const entry = /** @type {{ type?: string, text?: string }} */ (block);
      return entry.type === "text" ? entry.text || "" : "";
    })
    .join("");
}

/**
 * The "Changed N files → Review" card under a rebuilt turn, or null when the turn wrote nothing.
 * @param {{ files?: { path: string, add: number, del: number }[], userEntryId?: string, key?: string }} turn
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
function turnReviewCard(turn, t) {
  const changed = fileTotals(turn);
  if (changed.count === 0) return null;
  return el("div", { class: "turn-block-files" }, [
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm turn-block-review",
      dataset: { reviewKey: reviewKey(turn) },
      text: reviewLabel(t, changed),
      onClick: (/** @type {Event} */ event) =>
        reviewHandler?.(
          /** @type {Turn} */ (
            /** @type {unknown} */ ({ ...turn, number: promptNumber(event.currentTarget) })
          ),
        ),
    }),
  ]);
}

/**
 * The N of "You · turn N" above this card. The chat counts `.message.user` with a CSS counter.
 * @param {EventTarget | null} card
 */
function promptNumber(card) {
  if (!(card instanceof Element)) return 0;
  const list = card.closest(".messages") || card.parentElement?.parentElement;
  if (!list) return 0;
  let count = 0;
  for (const prompt of list.querySelectorAll(".message.user")) {
    if (prompt.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) count += 1;
  }
  return count;
}

/**
 * Append one Review card for this prompt. A second mount with the same entry replaces the first.
 * @param {HTMLElement | null | undefined} container
 * @param {{
 *   files?: { path: string, add: number, del: number }[],
 *   userEntryId?: string,
 *   key?: string,
 *   pendingKey?: string,
 * }} turn
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
export function mountReviewCard(container, turn, t) {
  const card = turnReviewCard(turn, t);
  if (!(container instanceof HTMLElement) || !card) return null;
  for (const key of [reviewKey(turn), turn.pendingKey || ""]) {
    if (!key) continue;
    const existing = container.querySelector(`[data-review-key="${cssAttr(key)}"]`);
    existing?.closest(".turn-block-files")?.remove();
    cardPaths.delete(key);
  }
  cardPaths.set(
    reviewKey(turn),
    (turn.files || []).map((file) => file.path),
  );
  container.appendChild(card);
  return card;
}

/** Paths each card in the chat wrote, so Session can list files the project history cannot see. */
const cardPaths = new Map();

export function chatChangedPaths() {
  return [...new Set([...cardPaths.values()].flat())];
}

/** A rebuilt or switched chat mounts its cards again. */
export function forgetChangedPaths() {
  cardPaths.clear();
}

/**
 * @param {{ files?: { add: number, del: number }[] }} turn
 */
function fileTotals(turn) {
  const files = turn.files || [];
  return {
    count: files.length,
    add: files.reduce((sum, file) => sum + file.add, 0),
    del: files.reduce((sum, file) => sum + file.del, 0),
  };
}

/**
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 * @param {{ count: number, add: number, del: number }} changed
 */
function reviewLabel(t, changed) {
  const value = tn("chat.turn.changed", changed.count, changed);
  if (value && !value.startsWith("chat.turn.changed")) return value;
  const key = changed.count === 1 ? "chat.turn.changed.one" : "chat.turn.changed.other";
  const fromCaller = t(key, changed);
  if (fromCaller && fromCaller !== key) return fromCaller;
  const noun = changed.count === 1 ? "file" : "files";
  return `Changed ${changed.count} ${noun} +${changed.add} −${changed.del} · Review`;
}

/**
 * @param {object} turn
 */
function reviewKey(turn) {
  const record = /** @type {{ userEntryId?: string, key?: string }} */ (turn);
  if (record.key) return record.key;
  return record.userEntryId ? `turn:${record.userEntryId}` : "";
}

/**
 * @param {string} value
 */
function cssAttr(value) {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/"/g, "");
}

/** @type {((turn: Turn) => void) | null} */
let reviewHandler = null;

/** @param {(turn: Turn) => void} handler */
export function registerTurnReview(handler) {
  reviewHandler = handler;
}

const NOTICE_KINDS = new Set(["info", "warning", "error"]);

/**
 * @param {Element | null | undefined} root
 * @param {Record<string, unknown> | null | undefined} request
 */
export function paintExtensionNotice(root, request) {
  if (!root || !("append" in root)) return;
  const message = request?.message;
  const text = typeof message === "string" ? message : "";
  if (!text.trim()) return;
  const raw = request?.notifyType ?? request?.severity;
  const severity = typeof raw === "string" && NOTICE_KINDS.has(raw) ? raw : "info";
  const line = document.createElement("p");
  line.className = "turn-block-notice";
  line.dataset.severity = severity;
  line.textContent = text;
  const turns = "querySelectorAll" in root ? root.querySelectorAll(".turn-block") : [];
  const turn = turns.length ? turns[turns.length - 1] : null;
  if (turn && "append" in turn) turn.append(line);
  else root.append(line);
}
