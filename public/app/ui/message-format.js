// ABOUTME: Pure helpers for chat message data: transcript cleanup, collapse rule, timestamps, images, text.
// ABOUTME: No DOM nodes are built here; message-renderer.js turns these values into the message view.

/**
 * @typedef {{ name: string, text: string }} ChatTranscriptLine
 *
 * @typedef {{
 *   type?: string,
 *   text?: string,
 *   thinking?: string,
 *   data?: string,
 *   mimeType?: string,
 * }} MessageContentBlock
 *
 * @typedef {{ total?: number }} MessageCost
 *
 * @typedef {{ cost?: MessageCost }} MessageUsage
 *
 * @typedef {{
 *   type?: string,
 *   content?: string,
 *   mimeType?: string,
 * }} MessageAttachment
 *
 * @typedef {{
 *   data?: string,
 *   mimeType?: string,
 * }} MessageImage
 *
 * @typedef {{
 *   id?: string,
 *   entryId?: string,
 *   entry_id?: string,
 *   role?: string,
 *   content?: string | MessageContentBlock[],
 *   text?: string,
 *   thinking?: string,
 *   timestamp?: number,
 *   usage?: MessageUsage | null,
 *   images?: MessageImage[],
 *   attachments?: MessageAttachment[],
 * }} ChatMessage
 */

const USER_MESSAGE_COLLAPSE_CHAR_THRESHOLD = 400;
const USER_MESSAGE_COLLAPSE_NEWLINE_THRESHOLD = 8;

/**
 * Detect and clean up pi-chat transcript format.
 *
 * Old format: `- [ISO-timestamp] [uid:ID] name: text`
 * New format:  `- [uid:ID] name: text`
 *
 * Returns the cleaned text (just `name: text` per line, deduplicated when
 * all lines share the same speaker), or null if the content doesn't look
 * like a chat transcript.
 */
/**
 * @param {string} text
 */
export function cleanChatTranscript(text) {
  if (!text || typeof text !== "string") return null;
  const lineRe = /^- (?:\[[\dT:.Z+-]+\] )?\[uid:[^\]]+\] ([^:]+): (.*)$/;
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;
  const parsed = lines.map((line) => {
    const match = line.match(lineRe);
    return match ? { name: match[1].trim(), text: match[2] } : null;
  });
  const cleaned = parsed.filter(
    /** @returns {line is ChatTranscriptLine} */
    (line) => line !== null,
  );
  if (cleaned.length !== parsed.length) return null;
  const names = [...new Set(cleaned.map((line) => line.name))];
  if (names.length === 1) {
    return cleaned.map((line) => line.text).join("\n");
  }
  return cleaned.map((line) => `**${line.name}**: ${line.text}`).join("\n\n");
}

/**
 * @param {ChatMessage | null | undefined} message
 * @param {string | null} [override]
 */
export function resolveMessageEntryId(message, override = null) {
  const id = override ?? message?.entryId ?? message?.entry_id ?? null;
  return typeof id === "string" && id ? id : null;
}

/**
 * @param {string} text
 */
export function shouldCollapseUserMessage(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return (
    text.length >= USER_MESSAGE_COLLAPSE_CHAR_THRESHOLD ||
    (text.match(/\n/g)?.length ?? 0) >= USER_MESSAGE_COLLAPSE_NEWLINE_THRESHOLD
  );
}

/**
 * Format a message timestamp for a chat log.
 *
 * Same calendar day (local time) → "HH:MM". A different day → "MM/DD HH:MM"
 * (no i18n — the numeric form reads the same across locales). Invalid or
 * missing input → "" so callers can render unconditionally and omit the
 * span when there is nothing to show. Intentionally does NOT reuse the
 * sidebar's relative-time `formatSessionTime`; chat logs want absolute
 * clock times, not "2h ago".
 */
/**
 * @param {number | null | undefined} timestampMs
 */
export function formatMessageTime(timestampMs) {
  // null / undefined must short-circuit before Number(): Number(null) === 0
  // is a finite value and would otherwise render the epoch as a real time.
  if (timestampMs == null) return "";
  const ms = Number(timestampMs);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  // Number.isFinite(1e20) passes, but new Date(1e20) is invalid (getTime → NaN).
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  /**
   * @param {number} n
   */
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return hhmm;
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${hhmm}`;
}

/** Full timestamp for the hover `title` (screen-reader / exact reference). */
/**
 * @param {number | null | undefined} timestampMs
 */
export function fullTimestampTitle(timestampMs) {
  const ms = Number(timestampMs);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  /**
   * @param {number} n
   */
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * @param {ChatMessage} message
 * @returns {MessageImage[]}
 */
export function collectImageItems(message) {
  /** @type {MessageImage[]} */
  const imageItems = [];
  if (message.images && message.images.length > 0) imageItems.push(...message.images);
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type === "image" && block.data) imageItems.push(block);
    }
  }
  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      if (attachment.type === "image" && attachment.content) {
        imageItems.push({ data: attachment.content, mimeType: attachment.mimeType });
      }
    }
  }
  return imageItems;
}

/**
 * @param {string | MessageContentBlock[] | undefined} content
 * @returns {string}
 */
export function textFromMessageContent(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * @param {MessageImage} image
 */
export function imageSource(image) {
  const data = typeof image?.data === "string" ? image.data : "";
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(data)) return data;
  const mime = /^image\/(?:png|jpe?g|gif|webp)$/i.test(image?.mimeType || "")
    ? image.mimeType
    : "image/png";
  return `data:${mime};base64,${data}`;
}

/**
 * @param {string | MessageContentBlock[] | null | undefined} content
 */
export function splitStreamingContent(content) {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };
  let text = "";
  let thinking = "";
  for (const block of content) {
    if (block?.type === "text") text += block.text ?? "";
    else if (block?.type === "thinking") thinking += block.thinking ?? "";
  }
  return { text, thinking };
}
