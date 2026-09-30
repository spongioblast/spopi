// ABOUTME: Buckets messages the way pi-context-view walks them for the context inspector tab.
// ABOUTME: It sums tokens per bucket and does not render anything.

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

/** @param {ContextMessage[]} [messages] */
export function bucketMessages(messages = []) {
  /** @type {Record<string, { tokens: number, items: ContextMessage[] }>} */
  const buckets = Object.fromEntries(BUCKETS.map((name) => [name, { tokens: 0, items: [] }]));
  for (const message of messages) {
    const bucket = classifyMessage(message);
    const tokens = Number(message.tokens || message.tokenCount || estimateTokens(message.content));
    buckets[bucket].tokens += Number.isFinite(tokens) ? tokens : 0;
    buckets[bucket].items.push(message);
  }
  return BUCKETS.map((name) => ({ name, ...buckets[name] })).sort((a, b) => b.tokens - a.tokens);
}

/** @param {unknown} content */
function estimateTokens(content) {
  const text = typeof content === "string" ? content : JSON.stringify(content || "");
  return Math.ceil(text.length / 4);
}

/** @param {Array<{ tokens?: number }>} [buckets] */
export function sumBucketTokens(buckets = []) {
  return buckets.reduce((sum, bucket) => sum + (Number(bucket.tokens) || 0), 0);
}
