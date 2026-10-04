// ABOUTME: Per-session pins for compact customInstructions, and one-way context drops.
// ABOUTME: A drop asks first, then the bridge, then dims that message.

import { t } from "../i18n/i18n.js";
import { confirmDialog } from "../ui/dialog.js";

/** @type {Map<string, Map<string, { id: string, text: string }>>} */
const pinsBySession = new Map();

/**
 * @param {unknown} item
 * @returns {string}
 */
function entryIdOf(item) {
  if (!item || typeof item !== "object") return "";
  const record = /** @type {{ id?: unknown, entryId?: unknown }} */ (item);
  if (typeof record.entryId === "string" && record.entryId) return record.entryId;
  if (typeof record.id === "string") return record.id;
  return "";
}

/**
 * @param {unknown} item
 * @returns {string}
 */
function textOf(item) {
  if (!item || typeof item !== "object") return "";
  const content = /** @type {{ content?: unknown, text?: unknown }} */ (item).content;
  const text = content ?? /** @type {{ text?: unknown }} */ (item).text ?? "";
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return text
    .map((block) => {
      if (typeof block === "string") return block;
      if (
        block &&
        typeof block === "object" &&
        typeof (/** @type {{ text?: unknown }} */ (block).text) === "string"
      ) {
        return /** @type {{ text: string }} */ (block).text;
      }
      return "";
    })
    .join("");
}

/**
 * @param {string} sessionId
 * @param {unknown} item
 */
export function pinContext(sessionId, item) {
  const id = entryIdOf(item);
  if (!sessionId || !id) return;
  let bucket = pinsBySession.get(sessionId);
  if (!bucket) {
    bucket = new Map();
    pinsBySession.set(sessionId, bucket);
  }
  bucket.set(id, { id, text: textOf(item).slice(0, 500) });
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function compactPreserveInstructions(sessionId) {
  const bucket = pinsBySession.get(sessionId);
  if (!bucket || bucket.size === 0) return "";
  const lines = [...bucket.values()].map((pin) => `${pin.id}: ${pin.text}`);
  return `Preserve verbatim:\n${lines.join("\n")}`;
}

/**
 * @param {unknown} item
 * @param {(entryId: string) => Promise<unknown>} request
 * @param {ParentNode | null} messages the chat list whose rows get dimmed
 */
export async function dropContext(item, request, messages) {
  const id = entryIdOf(item);
  if (!id) return;
  const confirmed = await confirmDialog({
    title: t("contextInspector.drop"),
    message: t("contextInspector.dropConfirm"),
    confirmLabel: t("contextInspector.drop"),
    danger: true,
  });
  if (!confirmed) return;
  const result = await request(id);
  if (
    result &&
    typeof result === "object" &&
    /** @type {{ ok?: unknown }} */ (result).ok === false
  ) {
    const error = /** @type {{ error?: unknown }} */ (result).error;
    throw new Error(typeof error === "string" ? error : "Drop failed");
  }
  for (const node of messages?.querySelectorAll(`[data-entry-id="${CSS.escape(id)}"]`) ?? []) {
    node.classList.add("context-dropped");
  }
}
