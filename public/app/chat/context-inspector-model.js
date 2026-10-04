// ABOUTME: Buckets messages the way pi-context-view walks them for the context inspector tab.
// ABOUTME: Token counts come only from the messages; a bucket with an uncounted item is unknown.

/**
 * @typedef {{
 *   role?: string,
 *   type?: string,
 *   customType?: string,
 *   kind?: string,
 *   path?: string,
 *   tokens?: number,
 *   tokenCount?: number,
 *   content?: unknown,
 *   id?: string,
 * }} ContextMessage
 */

const BUCKETS = ["system", "agents", "extensions", "files", "tools", "history", "compaction"];

/** @param {ContextMessage} [message] */
export function classifyMessage(message = {}) {
  const role = String(message.role || message.type || "").toLowerCase();
  const custom = String(message.customType || message.kind || "").toLowerCase();
  if (role === "system" || custom === "system") return "system";
  if (custom.includes("agents") || custom.includes("skill")) return "agents";
  if (custom.includes("extension") || custom.includes("inject")) return "extensions";
  if (custom.includes("file") || message.path) return "files";
  if (role === "tool" || custom.includes("tool")) return "tools";
  if (custom.includes("compact")) return "compaction";
  return "history";
}

/**
 * @param {ContextMessage} message
 * @returns {number | null}
 */
function countedTokens(message) {
  const tokens = Number(message.tokens ?? message.tokenCount);
  return Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
}

/**
 * @param {ContextMessage[]} [messages]
 * @returns {Array<{ name: string, tokens: number | null, items: ContextMessage[] }>}
 */
export function bucketMessages(messages = []) {
  /** @type {Record<string, { tokens: number | null, items: ContextMessage[] }>} */
  const buckets = Object.fromEntries(BUCKETS.map((name) => [name, { tokens: 0, items: [] }]));
  for (const message of messages) {
    const bucket = buckets[classifyMessage(message)];
    const tokens = countedTokens(message);
    bucket.tokens = tokens == null || bucket.tokens == null ? null : bucket.tokens + tokens;
    bucket.items.push(message);
  }
  return BUCKETS.map((name) => ({ name, ...buckets[name] })).sort(
    (a, b) => (b.tokens ?? -1) - (a.tokens ?? -1),
  );
}

/**
 * @param {Array<{ tokens?: number | null }>} [buckets]
 * @returns {number | null}
 */
export function sumBucketTokens(buckets = []) {
  let sum = 0;
  for (const bucket of buckets) {
    if (bucket.tokens == null) return null;
    sum += Number(bucket.tokens) || 0;
  }
  return sum;
}
