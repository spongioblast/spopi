// ABOUTME: Pulls a readable error string out of an assistant message or a runtime event.
// ABOUTME: Callers decide how to show it.

/**
 * Extract provider/LLM failure text from Pi runtime events.
 *
 * A failed Groq/OpenAI call typically arrives as:
 *   { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage, content: [] } }
 * The transcript has no assistant text, so the UI must read errorMessage itself.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmedString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.trim()
  ) {
    return value.message.trim();
  }
  return "";
}

/**
 * @param {{ role?: string, stopReason?: string, errorMessage?: unknown, error?: unknown } | null | undefined} message
 * @param {object} [options]
 * @param {string} [options.fallback]
 * @returns {string | null}
 */
export function extractAssistantError(message, { fallback } = {}) {
  if (!message || (message.role && message.role !== "assistant")) return null;
  const stop = typeof message.stopReason === "string" ? message.stopReason : "";
  if (stop === "aborted") return null;
  const text = trimmedString(message.errorMessage) || trimmedString(message.error);
  if (text) return text;
  if (stop === "error") return fallback || "The model request failed.";
  return null;
}

/**
 * @param {{
 *   type?: string,
 *   message?: { role?: string, stopReason?: string, errorMessage?: unknown, error?: unknown } | null,
 *   errorMessage?: unknown,
 *   error?: unknown,
 *   messages?: Array<{ role?: string, stopReason?: string, errorMessage?: unknown, error?: unknown }>,
 * } | null | undefined} event
 * @param {object} [options]
 * @param {string} [options.fallback]
 * @returns {string | null}
 */
export function extractRuntimeEventError(event, { fallback } = {}) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "message_end") {
    return extractAssistantError(event.message, { fallback });
  }
  if (event.type !== "agent_end" && event.type !== "agent_settled") return null;
  const direct = trimmedString(event.errorMessage) || trimmedString(event.error);
  if (direct) return direct;
  const messages = Array.isArray(event.messages) ? event.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const err = extractAssistantError(messages[i], { fallback });
    if (err) return err;
  }
  return extractAssistantError(event.message, { fallback });
}
