// ABOUTME: Renders user and assistant chat messages for the SPOPI WebView.
// ABOUTME: Composes footer, thinking, markup, and search helpers; exposes user elements for navigation.

/**
 * Message Renderer - Renders chat messages with markdown support
 *
 * @typedef {import("./message-format.js").ChatMessage} ChatMessage
 * @typedef {import("./message-format.js").MessageContentBlock} MessageContentBlock
 * @typedef {import("./message-format.js").MessageUsage} MessageUsage
 *
 * @typedef {{ sessionTreeActions?: boolean }} MessageRendererOptions
 *
 * @typedef {{ workspacePath?: string }} WelcomeOptions
 *
 * @typedef {{ scrollToFirst?: boolean }} HighlightSearchOptions
 *
 * @typedef {{ entryId?: string | null }} RenderUserMessageOptions
 */

import { onLocaleChange, t } from "../i18n/i18n.js";
import { chatFollow } from "./chat-follow.js";
import { formatUsd } from "./formatters.js";
import { mountImageLightbox } from "./image-lightbox.js";
import { renderMarkdown, renderStreamingMarkdown, renderUserMarkdown } from "./markdown.js";
import {
  copyableText,
  copyMessageButtonHtml,
  createCopyButton,
  createDurationSpan,
  createTimeSpan,
  createUserActionButton,
  createUserCollapseToggle,
  enableMessageCopy,
} from "./message-footer.js";
import {
  cleanChatTranscript,
  collectImageItems,
  formatMessageTime,
  fullTimestampTitle,
  imageSource,
  resolveMessageEntryId,
  splitStreamingContent,
  textFromMessageContent,
} from "./message-format.js";
import { appendMarkup, enhanceCodeBlocks, replaceMarkup } from "./message-markup.js";
import { clearSearchHighlights, highlightSearchMatches } from "./message-search.js";
import {
  enableThinkingToggles,
  releaseThinkingBlock,
  setThinkingHost,
  thinkingBlockHtml,
  updateStreamingThinkingBlock,
} from "./message-thinking.js";
import { escapeHtml } from "./sanitize-markup.js";

export { formatMessageTime, shouldCollapseUserMessage } from "./message-format.js";

/**
 * @typedef {HTMLElement & { _streamingRawText?: string | null }} StreamingMessageElement
 */

/**
 * @param {HTMLElement} element
 * @returns {string | null | undefined}
 */
function streamingRawText(element) {
  return /** @type {StreamingMessageElement} */ (element)._streamingRawText;
}

/**
 * @param {HTMLElement} element
 * @param {string | null} text
 */
function setStreamingRawText(element, text) {
  /** @type {StreamingMessageElement} */ (element)._streamingRawText = text;
}

/**
 * @param {string} tagName
 * @param {string} text
 * @param {string} [className]
 */
function textElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

export class MessageRenderer {
  /**
   * @param {HTMLElement} container
   * @param {MessageRendererOptions} [options]
   */
  constructor(container, { sessionTreeActions = false } = {}) {
    /** @type {HTMLElement | null} */
    this.container = container;
    // Session-tree actions (Fork/Edit) need a persisted session tree behind
    // the message list; ephemeral or detached views render no inert controls.
    this.sessionTreeActions = sessionTreeActions;
    /** @type {WelcomeOptions | null} */
    this.lastWelcomeOptions = null;
    this._destroyed = false;

    mountImageLightbox(this.container);

    chatFollow(this.container);

    /** @type {(() => boolean) | null} */
    this.unsubscribeLocaleChange = onLocaleChange(() => {
      if (!this.container) return;
      this.container.querySelectorAll(".message-copy-btn").forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        btn.setAttribute("aria-label", t("messages.copyMessage"));
        btn.title = t("messages.copyMessage");
      });
      this.container.querySelectorAll(".message-user-collapse-toggle").forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.textContent = t(expanded ? "messages.collapse" : "messages.expand");
      });
      this.container.querySelectorAll(".thinking-label-text").forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.textContent = t("messages.thinking");
      });
      this.container.querySelectorAll(".message.user").forEach((el) => {
        if (el instanceof HTMLElement) el.dataset.turnLabel = t("messages.youTurn");
      });
      if (this.container.querySelector(".welcome")) {
        this.renderWelcome(this.lastWelcomeOptions || {});
      }
    });
  }

  clear() {
    if (!this.container) return;
    this.container.replaceChildren();
    chatFollow(this.container).force();
  }

  clearSearchHighlights() {
    if (!this.container) return;
    clearSearchHighlights(this.container);
  }

  /**
   * @param {string} query
   * @param {HighlightSearchOptions} [options]
   */
  highlightSearchQuery(query, { scrollToFirst = true } = {}) {
    this.clearSearchHighlights();

    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    if (!normalizedQuery) return 0;
    if (!this.container) return 0;
    return highlightSearchMatches(this.container, normalizedQuery, scrollToFirst);
  }

  /**
   * @param {WelcomeOptions} [options]
   */
  renderWelcome({ workspacePath } = {}) {
    if (!this.container) return;
    this.lastWelcomeOptions = { workspacePath };
    const welcome = document.createElement("div");
    welcome.className = "welcome";

    const icon = document.createElement("div");
    icon.className = "welcome-icon";
    const logo = document.createElement("img");
    logo.src = "icons/logo-dark.svg";
    logo.alt = "SPOPI logo";
    logo.className = "welcome-logo";
    icon.appendChild(logo);
    welcome.appendChild(icon);

    welcome.appendChild(textElement("p", t("app.welcome")));
    welcome.appendChild(textElement("p", t("app.welcomeHint"), "hint"));
    if (workspacePath) {
      const workspace = document.createElement("p");
      workspace.className = "hint welcome-workspace";
      workspace.appendChild(document.createTextNode(`${t("app.currentWorkspace")} `));
      const code = document.createElement("code");
      code.textContent = workspacePath;
      workspace.appendChild(code);
      welcome.appendChild(workspace);
    }

    const shortcuts = document.createElement("div");
    shortcuts.className = "shortcuts-hint";
    shortcuts.setAttribute("aria-label", t("shell.keyboardShortcutsLabel"));
    const focusShortcut = textElement("span", "");
    appendMarkup(focusShortcut, `<kbd>/</kbd> ${escapeHtml(t("shortcuts.focusInput"))}`);
    const abortShortcut = textElement("span", "");
    appendMarkup(abortShortcut, `<kbd>Esc</kbd> ${escapeHtml(t("shortcuts.abort"))}`);
    shortcuts.append(focusShortcut, abortShortcut);
    welcome.appendChild(shortcuts);
    this.container.replaceChildren(welcome);
  }

  /**
   * @param {ChatMessage} message
   * @param {boolean} [isHistory]
   * @param {RenderUserMessageOptions} [options]
   */
  renderUserMessage(message, isHistory = false, { entryId = null } = {}) {
    if (!this.container) return null;
    const welcome = this.container.querySelector(".welcome");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = `message user${isHistory ? " history" : ""}`;
    div.dataset.turnLabel = t("messages.youTurn");

    const imageItems = collectImageItems(message);
    const content = document.createElement("div");
    content.className = "message-content";
    if (imageItems.length > 0) {
      const images = document.createElement("div");
      images.className = "message-images";
      for (const image of imageItems) {
        const imageElement = document.createElement("img");
        imageElement.className = "message-image";
        imageElement.src = imageSource(image);
        imageElement.alt = t("messages.attachedImage");
        images.appendChild(imageElement);
      }
      content.appendChild(images);
    }

    const rawContent = textFromMessageContent(message.content);
    const displayContent = cleanChatTranscript(rawContent) ?? rawContent;
    appendMarkup(content, renderUserMarkdown(displayContent));
    div.appendChild(content);

    const collapseToggle = createUserCollapseToggle(content, displayContent);
    const footer = document.createElement("div");
    footer.className = "message-footer";
    // Fixed user order: Expand → Fork → Edit → Copy →
    // Timestamp. Fork/Edit are session-tree actions gated to persisted trees;
    // the toolbar is always visible (no hover reveal).
    if (collapseToggle) footer.appendChild(collapseToggle);
    if (this.sessionTreeActions) {
      const actionText = typeof rawContent === "string" ? rawContent : "";
      footer.appendChild(createUserActionButton("fork", actionText));
      footer.appendChild(createUserActionButton("edit", actionText));
    }
    footer.appendChild(createCopyButton());
    const timeSpan = createTimeSpan(message.timestamp);
    if (timeSpan) footer.appendChild(timeSpan);
    const forkEntryId = resolveMessageEntryId(message, entryId);
    if (forkEntryId) {
      div.dataset.entryId = forkEntryId;
    }
    div.appendChild(footer);

    this.container.appendChild(div);
    enhanceCodeBlocks(div);
    enableMessageCopy(div);
    if (!isHistory) this.scrollToBottom();
    return div;
  }

  /**
   * @param {ChatMessage} message
   * @param {boolean} [isStreaming]
   * @param {boolean} [isHistory]
   * @param {HTMLElement | null} [targetContainer]
   */
  renderAssistantMessage(message, isStreaming = false, isHistory = false, targetContainer = null) {
    if (!this.container) return null;
    const welcome = this.container.querySelector(".welcome");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = `message assistant${isHistory ? " history" : ""}`;
    div.dataset.messageId = message.id || "streaming";
    // Jump targets for the Info panel. Process-group fragments share a
    // parent assistant entry; only the visible answer (or unterminated
    // leading text) should carry the session-tree id.
    const isProcessMessage = targetContainer !== null;
    const assistantEntryId = resolveMessageEntryId(message);
    if (assistantEntryId && !isProcessMessage) {
      div.dataset.entryId = assistantEntryId;
    }

    let contentHtml = "";
    let usageHtml = "";
    let rawStreamingText = "";
    let hasThinking = false;

    if (typeof message.content === "string") {
      rawStreamingText = message.content;
      contentHtml = isStreaming
        ? renderStreamingMarkdown(message.content)
        : renderMarkdown(message.content);
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block) continue;
        if (block.type === "text") {
          const blockText = block.text ?? "";
          rawStreamingText += blockText;
          contentHtml += isStreaming
            ? renderStreamingMarkdown(blockText)
            : renderMarkdown(blockText);
        } else if (block.type === "thinking" && !isStreaming) {
          hasThinking = true;
          contentHtml += this.renderThinkingBlock(block.thinking, message.usage?.cost?.total);
        }
      }
    }

    if (isStreaming) setStreamingRawText(div, rawStreamingText);

    const hasText = rawStreamingText.trim().length > 0;
    if (!isProcessMessage && message.usage?.cost && !hasThinking) {
      const cost = message.usage.cost.total;
      if (cost != null && cost > 0) {
        usageHtml = `<span class="message-usage">${formatUsd(cost, 4)}</span>`;
      }
    }
    const timeLabel = formatMessageTime(message.timestamp);
    const timeHtml = timeLabel
      ? `<span class="message-time" title="${escapeHtml(fullTimestampTitle(message.timestamp))}">${timeLabel}</span>`
      : "";

    const streamingClass = isStreaming ? " streaming" : "";

    if (!isStreaming && isHistory && !contentHtml) return null;

    const showFooter = !isStreaming && !isProcessMessage && (hasText || usageHtml);
    const footerHtml = showFooter
      ? `<div class="message-footer">${hasText ? copyMessageButtonHtml() : ""}${timeHtml}${usageHtml}</div>`
      : "";

    replaceMarkup(
      div,
      `<div class="message-content${streamingClass}"${isStreaming ? ' aria-live="polite"' : ""}>${contentHtml}</div>${footerHtml}`,
    );

    enableThinkingToggles(div);
    enhanceCodeBlocks(div);
    if (!isStreaming && hasText && !isProcessMessage) enableMessageCopy(div);
    (targetContainer || this.container).appendChild(div);
    if (!isHistory) this.scrollToBottom();

    return div;
  }

  /**
   * @param {string | undefined} thinking
   * @param {number | null | undefined} cost
   */
  renderThinkingBlock(thinking, cost) {
    return thinkingBlockHtml(thinking, cost);
  }

  /**
   * Stream this message's thinking into `host` instead of the message. The block stays
   * there after the message ends, so a step that only thought keeps its thought.
   * @param {HTMLElement} messageElement
   * @param {HTMLElement | null} host
   */
  setThinkingHost(messageElement, host) {
    setThinkingHost(messageElement, host);
  }

  /**
   * @param {HTMLElement} messageElement
   * @param {string} thinking
   */
  updateStreamingThinking(messageElement, thinking) {
    if (updateStreamingThinkingBlock(messageElement, thinking)) this.scrollToBottom();
  }

  /**
   * @param {HTMLElement} messageElement
   * @param {string | MessageContentBlock[]} content
   */
  updateStreamingMessage(messageElement, content) {
    const contentDiv = messageElement.querySelector(".message-content");
    if (!(contentDiv instanceof HTMLElement)) return;

    const { text, thinking } = this.splitStreamingContent(content);

    if (thinking) this.updateStreamingThinking(messageElement, thinking);

    // Only overwrite the accumulated raw text when the update actually contains
    // text content. If the final message_end event carries only tool_use blocks
    // (no text), we must keep the text that streamed in earlier so that
    // finalizeStreamingMessage can re-render it correctly.
    if (text) setStreamingRawText(messageElement, text);
    const thinkingBlock = contentDiv.querySelector(".streaming-thinking");
    const rendered = renderStreamingMarkdown(text);
    if (thinkingBlock) {
      const existingText = contentDiv.querySelector(".streaming-text");
      /** @type {HTMLElement} */
      let textNode;
      if (existingText instanceof HTMLElement) {
        textNode = existingText;
      } else {
        textNode = document.createElement("div");
        textNode.className = "streaming-text";
        contentDiv.appendChild(textNode);
      }
      replaceMarkup(textNode, text ? rendered : textNode.innerHTML);
    } else if (text) {
      replaceMarkup(contentDiv, rendered);
    }
    enhanceCodeBlocks(contentDiv);
    this.scrollToBottom();
  }

  /**
   * @param {string | MessageContentBlock[] | null | undefined} content
   */
  splitStreamingContent(content) {
    return splitStreamingContent(content);
  }

  /**
   * @param {HTMLElement} messageElement
   * @param {MessageUsage | null} [usage]
   * @param {string} [thinking]
   * @param {number | null} [durationMs]
   */
  finalizeStreamingMessage(messageElement, usage = null, thinking = "", durationMs = null) {
    const contentDiv = messageElement.querySelector(".message-content");
    const hosted = releaseThinkingBlock(messageElement);
    const thinkingElsewhere = Boolean(hosted && !messageElement.contains(hosted));
    let finalThinking = "";
    if (contentDiv instanceof HTMLElement && thinkingElsewhere) {
      contentDiv.classList.remove("streaming");
      const stored = streamingRawText(messageElement);
      const rawText = typeof stored === "string" ? stored : contentDiv.textContent || "";
      setStreamingRawText(messageElement, null);
      replaceMarkup(contentDiv, renderMarkdown(rawText));
      enhanceCodeBlocks(contentDiv);
    } else if (contentDiv instanceof HTMLElement) {
      contentDiv.classList.remove("streaming");
      const streamingText = contentDiv.querySelector(".streaming-text");
      const domText = streamingText ? streamingText.textContent : contentDiv.textContent;
      const stored = streamingRawText(messageElement);
      const rawText = typeof stored === "string" ? stored : domText;
      setStreamingRawText(messageElement, null);

      finalThinking =
        thinking ||
        contentDiv.querySelector(".streaming-thinking .thinking-content")?.textContent ||
        "";

      let html = "";
      if (finalThinking) {
        html += this.renderThinkingBlock(finalThinking, usage?.cost?.total);
      }
      html += renderMarkdown(rawText);
      replaceMarkup(contentDiv, html);
      enableThinkingToggles(contentDiv);
      enhanceCodeBlocks(contentDiv);
    }

    if (!messageElement.querySelector(".message-footer")) {
      const copyable = this.getCopyableText(messageElement);
      const usageCost = usage?.cost;
      const hasUsage = Boolean(
        usageCost &&
          usageCost.total != null &&
          usageCost.total > 0 &&
          !finalThinking &&
          !thinkingElsewhere,
      );
      if (!copyable && !hasUsage) {
        messageElement.remove();
        return;
      }

      const footer = document.createElement("div");
      footer.className = "message-footer";

      if (copyable) footer.appendChild(createCopyButton());

      const timeSpan = createTimeSpan(Date.now());
      if (timeSpan) footer.appendChild(timeSpan);

      const durationSpan = createDurationSpan(durationMs);
      if (durationSpan) footer.appendChild(durationSpan);

      if (hasUsage && usageCost && usageCost.total != null) {
        const span = document.createElement("span");
        span.className = "message-usage";
        span.textContent = formatUsd(usageCost.total, 4);
        footer.appendChild(span);
      }

      messageElement.appendChild(footer);
      enableMessageCopy(messageElement);
    }
  }

  /**
   * @param {string} text
   */
  renderSystemMessage(text) {
    if (!this.container) return;
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;
    this.container.appendChild(div);
    this.scrollToBottom();
  }

  /**
   * @param {string} errorMessage
   */
  renderError(errorMessage) {
    if (!this.container) return;
    const div = document.createElement("div");
    div.className = "error-message";
    div.textContent = `⚠️ ${errorMessage}`;
    this.container.appendChild(div);
    this.scrollToBottom();
  }

  /**
   * @param {HTMLElement} messageEl
   */
  getCopyableText(messageEl) {
    return copyableText(messageEl);
  }

  scrollToBottom() {
    if (this.container) chatFollow(this.container).follow();
  }

  forceScrollToBottom() {
    if (this.container) chatFollow(this.container).force();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (typeof this.unsubscribeLocaleChange === "function") {
      this.unsubscribeLocaleChange();
      this.unsubscribeLocaleChange = null;
    }
    this.container = null;
  }
}
