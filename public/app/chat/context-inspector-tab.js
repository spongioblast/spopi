// ABOUTME: Context inspector tab: pin / drop / compact over the bucketed walk.
// ABOUTME: Opening it does not change the session transcript.

import { bucketMessages, sumBucketTokens } from "./context-inspector-model.js";

/**
 * @param {HTMLElement | null | undefined} root
 * @param {{
 *   messages?: Array<{ id?: string, role?: string, type?: string, customType?: string, kind?: string, path?: string, tokens?: number, tokenCount?: number, content?: unknown }>,
 *   onPin?: (item: unknown) => void,
 *   onDrop?: (item: unknown) => void,
 *   onCompact?: () => void,
 *   t?: (key: string) => string,
 * }} [options]
 */
export function mountContextInspector(
  root,
  { messages = [], onPin, onDrop, onCompact, t = (key) => key } = {},
) {
  if (!root) return null;
  root.replaceChildren();
  const buckets = bucketMessages(messages);
  /** @param {number | null} tokens */
  const count = (tokens) => (tokens == null ? t("contextInspector.unknown") : String(tokens));
  const total = document.createElement("p");
  total.textContent = `${t("contextInspector.title")} · ${count(sumBucketTokens(buckets))}`;
  root.appendChild(total);
  for (const bucket of buckets) {
    const block = document.createElement("section");
    block.dataset.bucket = bucket.name;
    const title = document.createElement("h4");
    title.textContent = `${bucket.name} (${count(bucket.tokens)})`;
    block.appendChild(title);
    for (const item of bucket.items) {
      const row = document.createElement("div");
      row.className = "context-item";
      const label = document.createElement("span");
      label.textContent = item.id || item.role || bucket.name;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = t("contextInspector.pin");
      pin.addEventListener("click", () => onPin?.(item));
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = t("contextInspector.drop");
      drop.addEventListener("click", () => onDrop?.(item));
      row.append(label, pin, drop);
      block.appendChild(row);
    }
    root.appendChild(block);
  }
  const compact = document.createElement("button");
  compact.type = "button";
  compact.className = "ui-button";
  compact.textContent = t("contextInspector.compact");
  compact.addEventListener("click", () => onCompact?.());
  root.appendChild(compact);
  return {
    buckets,
    /** @param {typeof messages} next */
    setMessages(next) {
      mountContextInspector(root, { messages: next, onPin, onDrop, onCompact, t });
    },
  };
}
