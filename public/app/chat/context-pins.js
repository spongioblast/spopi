// ABOUTME: Per-session pins for compact customInstructions, and one-way context drops.
// ABOUTME: A drop asks first, then the bridge, then dims that message.

import { t } from "../i18n/i18n.js";
import { openDialog } from "../ui/dialog.js";

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

/** @returns {Promise<boolean>} */
function confirmDrop() {
  const root = document.getElementById("dialog-container");
  if (!root) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    /** @param {boolean} value */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = document.createElement("p");
    body.textContent = t("contextInspector.dropConfirm");
    const dialog = openDialog({
      title: t("contextInspector.drop"),
      body,
      actions: [
        {
          label: t("actions.cancel"),
          onClick: () => {
            finish(false);
            dialog.close();
          },
        },
        {
          label: t("contextInspector.drop"),
          onClick: () => {
            finish(true);
            dialog.close();
          },
        },
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * @param {string} entryId
 */
function markContextDropped(entryId) {
  if (!entryId) return;
  const selector = `[data-entry-id="${CSS.escape(entryId)}"]`;
  for (const node of document.querySelectorAll(selector)) {
    node.classList.add("context-dropped");
  }
}

/**
 * @param {unknown} item
 * @param {(entryId: string) => Promise<unknown>} request
 */
export async function dropContext(item, request) {
  const id = entryIdOf(item);
  if (!id) return;
  if (!(await confirmDrop())) return;
  const result = await request(id);
  if (
    result &&
    typeof result === "object" &&
    /** @type {{ ok?: unknown }} */ (result).ok === false
  ) {
    const error = /** @type {{ error?: unknown }} */ (result).error;
    throw new Error(typeof error === "string" ? error : "Drop failed");
  }
  markContextDropped(id);
}
