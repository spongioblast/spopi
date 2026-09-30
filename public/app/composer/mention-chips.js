// ABOUTME: Inline pills for composer @-mentions. A mirror paints each @token as a pill
// ABOUTME: with a remove cross; the textarea value stays the @path Pi receives.

import { previewFile } from "../chat/file-actions.js";
import { t } from "../i18n/i18n.js";

// An optional `:12` or `:12-30` after the path is a line range (Ask Pi on an editor selection).
const TOKEN_RE = /(^|[\s=])(@(?:"[^"]+"|[A-Za-z0-9_./\\-]+\/?)(?::\d+(?:-\d+)?)?)/g;
const RANGE_RE = /:(\d+)(?:-(\d+))?$/;

// Textarea styles the mirror must copy so its text lands on the same pixels.
/** @type {readonly string[]} */
const MIRRORED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textIndent",
  "textTransform",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
];

/**
 * @typedef {{
 *   raw: string,
 *   path: string,
 *   range: string,
 *   line: number | undefined,
 *   start: number,
 *   end: number,
 * }} MentionChip
 *
 * @param {unknown} text
 * @returns {MentionChip[]}
 */
export function parseAtMentions(text) {
  /** @type {MentionChip[]} */
  const mentions = [];
  const source = String(text || "");
  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(source);
  while (match) {
    const raw = match[2];
    const rangeMatch = RANGE_RE.exec(raw);
    const range = rangeMatch ? rangeMatch[0] : "";
    mentions.push({
      raw,
      path: unquoteMention(raw.slice(1, raw.length - range.length)),
      range,
      line: rangeMatch ? Number(rangeMatch[1]) : undefined,
      start: match.index + match[1].length,
      end: match.index + match[0].length,
    });
    match = TOKEN_RE.exec(source);
  }
  return mentions;
}

/** @param {string} token */
function unquoteMention(token) {
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    return token.slice(1, -1);
  }
  return token;
}

/** @param {unknown} path */
function mentionLabel(path) {
  const trimmed = String(path || "").replace(/[/\\]+$/, "");
  return trimmed.split(/[/\\]/).pop() || String(path || "");
}

/**
 * @param {MentionChip[]} mentions
 * @param {number} caret
 * @returns {MentionChip | null}
 */
export function mentionAtCaret(mentions, caret) {
  return mentions.find((m) => caret >= m.start && caret <= m.end) || null;
}

/**
 * Narrow a node that may come from another document/window.
 * @param {EventTarget | Element | null | undefined} node
 * @returns {HTMLElement | null}
 */
function asClickableElement(node) {
  if (!node || !("click" in node) || typeof node.click !== "function") return null;
  if (!("style" in node)) return null;
  return /** @type {HTMLElement} */ (node);
}

/**
 * @param {object} [options]
 * @param {HTMLTextAreaElement | HTMLInputElement | null} [options.input]
 * @param {Element | null} [options.host]
 * @param {(path: string) => string} [options.resolveAbsolute]
 * @param {(path: string) => void} [options.onOpen]
 * @param {(mention: MentionChip) => void} [options.onRemove]
 */
export function mountMentionChips({
  input,
  host,
  resolveAbsolute = (path) => path,
  onOpen,
  onRemove,
} = {}) {
  if (!input || !host) return { refresh() {}, destroy() {} };
  // Locals so nested closures keep the early-return narrowing.
  const inputEl = input;
  const hostEl = host;

  let layerNode = hostEl.querySelector(".composer-mention-layer");
  if (!layerNode) {
    layerNode = document.createElement("div");
    layerNode.className = "composer-mention-layer";
    layerNode.setAttribute("aria-hidden", "true");
    inputEl.before(layerNode);
  }
  const layerCandidate = asClickableElement(layerNode);
  if (!layerCandidate) return { refresh() {}, destroy() {} };
  const layer = layerCandidate;

  /** @type {MentionChip[]} */
  let mentions = [];

  function syncBox() {
    const style = getComputedStyle(inputEl);
    const layerStyle = /** @type {Record<string, string>} */ (/** @type {unknown} */ (layer.style));
    const computed = /** @type {Record<string, string>} */ (/** @type {unknown} */ (style));
    for (const prop of MIRRORED_STYLES) layerStyle[prop] = computed[prop];
    layer.style.left = `${inputEl.offsetLeft}px`;
    layer.style.top = `${inputEl.offsetTop}px`;
    layer.style.width = `${inputEl.clientWidth}px`;
    layer.style.height = `${inputEl.clientHeight}px`;
    layer.scrollTop = inputEl.scrollTop;
  }

  function refresh() {
    const value = inputEl.value;
    mentions = parseAtMentions(value);
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const mention of mentions) {
      if (mention.start > cursor) frag.append(value.slice(cursor, mention.start));
      frag.append(mentionPill(mention));
      cursor = mention.end;
    }
    // Trailing newline needs a visible line box so heights stay identical.
    frag.append(value.slice(cursor) + (value.endsWith("\n") ? " " : ""));
    layer.replaceChildren(frag);
    layer.hidden = mentions.length === 0;
    inputEl.classList.toggle("has-mention-layer", mentions.length > 0);
    syncBox();
  }

  /**
   * The pill shows exactly the token's characters, so it is as wide as the text under the caret.
   * @param {MentionChip} mention
   */
  function mentionPill(mention) {
    const pill = document.createElement("mark");
    pill.className = "composer-mention-inline";
    pill.dataset.path = mention.path;
    pill.title = `${resolveAbsolute(mention.path)}${mention.range}`;
    const rest = mention.raw.slice(1, mention.raw.length - mention.range.length);
    const name = mentionLabel(mention.path);
    const at = rest.lastIndexOf(name);
    const parts = [
      ["composer-mention-at", "@"],
      ["composer-mention-dir", at > 0 ? rest.slice(0, at) : ""],
      ["composer-mention-name", at >= 0 ? name : rest],
      ["composer-mention-dir", at >= 0 ? rest.slice(at + name.length) : ""],
      ["composer-mention-dir", mention.range],
    ];
    for (const [className, text] of parts) {
      if (!text) continue;
      const span = document.createElement("span");
      span.className = className;
      span.textContent = text;
      pill.append(span);
    }
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMention(mention);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "composer-mention-remove";
    remove.textContent = "×";
    remove.title = t("composer.mentionRemove", { name });
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeMention(mention);
      inputEl.focus();
    });
    pill.append(remove);
    return pill;
  }

  /** @param {MentionChip} mention */
  function openMention(mention) {
    onOpen?.(mention.path);
    previewFile(mention.path, mention.line);
  }

  /**
   * One space around the gap is enough; a mention at the very start takes its space with it.
   * @param {MentionChip} mention
   */
  function removeMention(mention) {
    const before = inputEl.value.slice(0, mention.start);
    let after = inputEl.value.slice(mention.end);
    if (/(^|\s)$/.test(before)) after = after.replace(/^[ \t]+/, "");
    inputEl.value = `${before}${after}`;
    const caret = Math.min(mention.start, inputEl.value.length);
    inputEl.setSelectionRange(caret, caret);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    onRemove?.(mention);
  }

  /** @param {Event} event */
  function onKeydown(event) {
    if (inputEl.selectionStart !== inputEl.selectionEnd) return;
    const caret = inputEl.selectionStart ?? 0;
    const key = "key" in event ? String(/** @type {{ key?: unknown }} */ (event).key) : "";
    const mention = mentions.find((item) =>
      key === "Backspace"
        ? caret > item.start && caret <= item.end
        : key === "Delete" && caret >= item.start && caret < item.end,
    );
    if (!mention) return;
    event.preventDefault();
    removeMention(mention);
  }

  /** @param {Event} event */
  function onClick(event) {
    const ctrl =
      "ctrlKey" in event && Boolean(/** @type {{ ctrlKey?: unknown }} */ (event).ctrlKey);
    const meta =
      "metaKey" in event && Boolean(/** @type {{ metaKey?: unknown }} */ (event).metaKey);
    if (!(ctrl || meta)) return;
    const mention = mentionAtCaret(mentions, inputEl.selectionStart ?? -1);
    if (!mention) return;
    event.preventDefault();
    openMention(mention);
  }

  const onScroll = () => {
    layer.scrollTop = inputEl.scrollTop;
  };
  inputEl.addEventListener("input", refresh);
  inputEl.addEventListener("change", refresh);
  inputEl.addEventListener("scroll", onScroll);
  inputEl.addEventListener("keydown", onKeydown);
  inputEl.addEventListener("click", onClick);
  const form = inputEl.closest("form");
  const onSubmit = () => queueMicrotask(refresh);
  form?.addEventListener("submit", onSubmit);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => syncBox()) : null;
  resize?.observe(inputEl);
  refresh();
  return {
    refresh,
    destroy() {
      inputEl.removeEventListener("input", refresh);
      inputEl.removeEventListener("change", refresh);
      inputEl.removeEventListener("scroll", onScroll);
      inputEl.removeEventListener("keydown", onKeydown);
      inputEl.removeEventListener("click", onClick);
      form?.removeEventListener("submit", onSubmit);
      resize?.disconnect();
      inputEl.classList.remove("has-mention-layer");
      layer.remove();
    },
  };
}
