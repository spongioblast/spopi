// ABOUTME: Accumulates streaming assistant text and tool calls into one message object.
// ABOUTME: It does not touch the DOM.

/**
 * @typedef {{ type: "text", text: string }} TextBlock
 * @typedef {{ type: "thinking", thinking: string }} ThinkingBlock
 * @typedef {{ type: "toolCall", id: string, name: string, arguments: Record<string, unknown> }} ToolCallBlock
 * @typedef {TextBlock | ThinkingBlock | ToolCallBlock | { type: string, [key: string]: unknown }} ContentBlock
 * @typedef {{ role: string, content: Array<ContentBlock>, usage?: unknown }} AssistantMessage
 */

/** @returns {AssistantMessage} */
function createEmptyAssistantMessage() {
  return { role: "assistant", content: [] };
}

/**
 * @param {{ role?: string, content?: unknown, usage?: unknown } | null | undefined} message
 * @returns {AssistantMessage}
 */
function cloneMessage(message) {
  if (message?.role !== "assistant") return createEmptyAssistantMessage();
  return /** @type {AssistantMessage} */ ({
    ...message,
    content: Array.isArray(message.content)
      ? structuredClone(message.content)
      : message.content || [],
  });
}

/**
 * @param {Array<ContentBlock>} content
 * @param {number} index
 * @param {string} type
 * @returns {ContentBlock}
 */
function ensureBlock(content, index, type) {
  const existing = content[index];
  if (existing?.type === type) return existing;

  const block =
    type === "thinking"
      ? { type: "thinking", thinking: "" }
      : type === "toolCall"
        ? { type: "toolCall", id: "", name: "", arguments: {} }
        : { type: "text", text: "" };
  content[index] = block;
  return block;
}

/**
 * @param {AssistantMessage} message
 * @param {unknown} event
 * @returns {AssistantMessage}
 */
function applyDelta(message, event) {
  const record =
    event && typeof event === "object"
      ? /** @type {{
         *   assistantMessageEvent?: {
         *     contentIndex?: number,
         *     type?: string,
         *     delta?: string,
         *     content?: string,
         *     toolCall?: ContentBlock,
         *   },
         *   usage?: unknown,
         * }} */ (event)
      : null;
  const delta = record?.assistantMessageEvent;
  if (!delta) return message;
  const contentIndex = delta.contentIndex;
  if (!Number.isInteger(contentIndex) || /** @type {number} */ (contentIndex) < 0) return message;
  const index = /** @type {number} */ (contentIndex);

  const content = message.content;
  switch (delta.type) {
    case "text_start":
      ensureBlock(content, index, "text");
      break;
    case "text_delta": {
      const block = /** @type {TextBlock} */ (ensureBlock(content, index, "text"));
      block.text += delta.delta ?? "";
      break;
    }
    case "text_end": {
      const block = /** @type {TextBlock} */ (ensureBlock(content, index, "text"));
      if (typeof delta.content === "string") block.text = delta.content;
      break;
    }
    case "thinking_start":
      ensureBlock(content, index, "thinking");
      break;
    case "thinking_delta": {
      const block = /** @type {ThinkingBlock} */ (ensureBlock(content, index, "thinking"));
      block.thinking += delta.delta ?? "";
      break;
    }
    case "thinking_end": {
      const block = /** @type {ThinkingBlock} */ (ensureBlock(content, index, "thinking"));
      if (typeof delta.content === "string") block.thinking = delta.content;
      break;
    }
    case "toolcall_start":
      ensureBlock(content, index, "toolCall");
      break;
    case "toolcall_end":
      if (delta.toolCall) content[index] = structuredClone(delta.toolCall);
      break;
  }
  if (record?.usage) message.usage = structuredClone(record.usage);
  return message;
}

/**
 * Pure assistant delta. Callers pass a message they can replace; this returns a new one.
 * @param {{ role?: string, content?: unknown, usage?: unknown } | null | undefined} message
 * @param {Parameters<typeof applyDelta>[1]} event
 * @returns {AssistantMessage}
 */
export function reduceAssistantMessage(message, event) {
  return applyDelta(cloneMessage(message ?? createEmptyAssistantMessage()), event);
}

/** Assemble Pi's delta-only message_update protocol into a live assistant message. */
export function createAssistantMessageStream() {
  /** @type {AssistantMessage | null} */
  let message = null;

  return {
    /**
     * @param {AssistantMessage | null | undefined} initialMessage
     * @returns {AssistantMessage}
     */
    start(initialMessage) {
      message = cloneMessage(initialMessage);
      return structuredClone(message);
    },
    /**
     * @param {Parameters<typeof applyDelta>[1]} event
     * @returns {AssistantMessage}
     */
    update(event) {
      message = applyDelta(message ?? createEmptyAssistantMessage(), event);
      return structuredClone(message);
    },
    /**
     * @param {AssistantMessage | null | undefined} finalMessage
     * @returns {AssistantMessage}
     */
    finish(finalMessage) {
      const completed = cloneMessage(finalMessage ?? message);
      message = null;
      return completed;
    },
    reset() {
      message = null;
    },
    /** @returns {AssistantMessage | null} */
    current() {
      return message ? structuredClone(message) : null;
    },
  };
}
