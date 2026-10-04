// ABOUTME: Renders collapsible tool execution cards and their streaming output.
// ABOUTME: Uses container-level event delegation so dynamically added cards need no per-element listeners.

import { previewFile, runInTerminal } from "../chat/file-actions.js";
import { onLocaleChange, t } from "../i18n/i18n.js";
import { chatFollow } from "./chat-follow.js";
import { copyText } from "./clipboard.js";
import {
  appendToolResultImages,
  createArgsPreview,
  createNestedRow,
  createToolChevron,
  createToolCopyButton,
  renderNestedRecord,
  renderToolDiff,
  showSavedOutput,
} from "./tool-card-parts.js";
import {
  formatToolJson,
  formatToolResult,
  nestedRecord,
  toolArgsPreview,
} from "./tool-card-result.js";
import { displayToolName } from "./tool-display-name.js";

/**
 * @typedef {import("./tool-card-result.js").ToolArgs} ToolArgs
 * @typedef {import("./tool-card-result.js").ToolResult} ToolResult
 * @typedef {import("./tool-card-result.js").NestedCallRecord} NestedCallRecord
 * @typedef {import("./tool-card-parts.js").NestedCall} NestedCall
 */

/**
 * @typedef {object} ToolExecution
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {ToolArgs} [args]
 * @property {string} [status]
 * @property {string} [output]
 */

export class ToolCardRenderer {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    /** @type {HTMLElement | null} */
    this.container = container;
    /** @type {HTMLElement | null} */
    this.liveTarget = null;
    /** @type {Map<string, HTMLElement>} */
    this.toolCards = new Map(); // toolCallId -> element
    this._destroyed = false;

    // Toggle header expand/collapse via event delegation. A single listener on
    // the container handles every card, including ones added later for history.
    /**
     * @type {((e: Event) => void) | null}
     */
    this._onContainerClickToggle = (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const header = target.closest(".tool-card-header");
      if (!header) return;
      // Don't toggle when clicking action buttons inside the header
      if (target.closest(".tool-action-btn, .tool-file-ref")) return;
      const card = header.closest(".tool-card");
      if (!card) return;
      card.querySelector(".tool-card-body")?.classList.toggle("expanded");
      header.querySelector(".tool-card-chevron")?.classList.toggle("expanded");
    };

    /**
     * @type {((e: Event) => void) | null}
     */
    this._onContainerClickCopy = (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(".copy-output-btn");
      if (!(btn instanceof HTMLElement)) return;
      e.stopPropagation();
      const output = btn.closest(".tool-card")?.querySelector(".tool-output");
      const text = output?.textContent?.trim();
      if (!text) return;
      copyText(text).then(() => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      });
    };

    this.container.addEventListener("click", this._onContainerClickToggle);
    this.container.addEventListener("click", this._onContainerClickCopy);
    /**
     * @type {((e: Event) => void) | null}
     */
    this._onContainerClickFileRef = (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(".tool-file-ref");
      if (!(btn instanceof HTMLElement)) return;
      e.stopPropagation();
      e.preventDefault();
      const path = btn.dataset.path;
      if (!path || !this.container) return;
      this.container && previewFile(path);
    };
    this.container.addEventListener("click", this._onContainerClickFileRef);
    /**
     * @type {((e: Event) => void) | null}
     */
    this._onContainerClickRun = (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(".tool-run-in-terminal");
      if (!(btn instanceof HTMLElement)) return;
      e.stopPropagation();
      e.preventDefault();
      const command = btn.dataset.command;
      if (!command) return;
      runInTerminal(command);
    };
    this.container.addEventListener("click", this._onContainerClickRun);

    // Re-localize rendered status text and copy-button labels on locale change.
    /** @type {(() => boolean) | null} */
    this.unsubscribeLocaleChange = onLocaleChange(() => {
      if (!this.container) return;
      for (const el of this.container.querySelectorAll(".tool-status[data-status]")) {
        if (!(el instanceof HTMLElement)) continue;
        el.textContent = t(`tools.${el.dataset.status}`);
      }
      for (const el of this.container.querySelectorAll(".copy-output-btn")) {
        if (!(el instanceof HTMLElement)) continue;
        const label = t("tools.copyOutput");
        el.title = label;
        el.setAttribute("aria-label", label);
      }
      for (const el of this.container.querySelectorAll(".tool-file-ref")) {
        if (!(el instanceof HTMLElement)) continue;
        const label = t("tools.openInPreview");
        el.title = label;
        const path = el.dataset.path || el.textContent;
        el.setAttribute("aria-label", `${label}: ${path}`);
      }
      for (const el of this.container.querySelectorAll(".tool-output-saved-label")) {
        el.textContent = t("tools.outputSaved");
      }
    });
  }

  /**
   * @param {ToolExecution} toolExecution
   */
  createToolCard(toolExecution) {
    const { toolCallId, toolName, args, status } = toolExecution;

    const card = document.createElement("div");
    card.className = "tool-card";
    card.dataset.toolCallId = toolCallId;

    const argsPreview = this.getArgsPreview(toolName, args);
    const argsJson = this.formatJson(args);
    const isExpanded = status === "streaming" || status === "pending";

    const oldText = args?.oldText || args?.old_text;
    const newText = args?.newText || args?.new_text;
    const isEdit =
      (toolName === "edit" || toolName === "Edit") && Boolean(oldText) && Boolean(newText);

    const header = document.createElement("div");
    header.className = "tool-card-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "tool-header-left";
    const chevron = createToolChevron(isExpanded);
    headerLeft.appendChild(chevron);

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = displayToolName(toolName);
    name.title = toolName;
    headerLeft.appendChild(name);
    if (argsPreview) {
      headerLeft.appendChild(createArgsPreview(argsPreview, args));
    }
    header.appendChild(headerLeft);

    const headerRight = document.createElement("div");
    headerRight.className = "tool-header-right";
    headerRight.appendChild(createToolCopyButton());

    const statusElement = document.createElement("div");
    statusElement.className = `tool-status ${status}`;
    statusElement.dataset.status = status;
    statusElement.textContent = t(`tools.${status}`);
    headerRight.appendChild(statusElement);
    header.appendChild(headerRight);

    const body = document.createElement("div");
    body.className = `tool-card-body${isExpanded ? " expanded" : ""}`;
    if (isEdit && oldText && newText) {
      body.appendChild(this.renderDiff(oldText, newText));
    } else if (argsJson) {
      const argsElement = document.createElement("div");
      argsElement.className = "tool-args";
      argsElement.textContent = argsJson;
      body.appendChild(argsElement);
    }
    const outputWrapper = document.createElement("div");
    outputWrapper.className = "tool-output-wrapper";
    const output = document.createElement("div");
    output.className = "tool-output";
    outputWrapper.appendChild(output);
    body.appendChild(outputWrapper);

    card.append(header, body);
    (this.liveTarget?.isConnected ? this.liveTarget : this.container)?.appendChild(card);
    this.toolCards.set(toolCallId, card);
    this.scrollToBottom();

    return card;
  }

  /**
   * @param {ToolExecution} toolExecution
   */
  updateToolCard(toolExecution) {
    let card = this.toolCards.get(toolExecution.toolCallId);

    if (!card) {
      card = this.createToolCard(toolExecution);
    }

    // Update status
    const statusElement = card.querySelector(".tool-status");
    if (statusElement instanceof HTMLElement) {
      statusElement.className = `tool-status ${toolExecution.status}`;
      statusElement.dataset.status = toolExecution.status;
      statusElement.textContent = t(`tools.${toolExecution.status}`);
    }

    // Auto-expand when streaming
    if (toolExecution.status === "streaming") {
      const body = card.querySelector(".tool-card-body");
      const chevron = card.querySelector(".tool-card-chevron");
      if (body) body.classList.add("expanded");
      if (chevron) chevron.classList.add("expanded");
    }

    // Update output
    const outputElement = card.querySelector(".tool-output");
    if (outputElement && toolExecution.output) {
      outputElement.textContent = toolExecution.output;
      this.scrollToBottom();
    }
  }

  /**
   * @param {string} toolCallId
   * @param {ToolResult | string | null | undefined} result
   * @param {boolean} isError
   */
  finalizeToolCard(toolCallId, result, isError) {
    const card = this.toolCards.get(toolCallId);
    if (!card) return;

    // Update status
    const statusElement = card.querySelector(".tool-status");
    if (statusElement instanceof HTMLElement) {
      const status = isError ? "error" : "complete";
      statusElement.className = `tool-status ${status}`;
      statusElement.dataset.status = status;
      statusElement.textContent = t(`tools.${status}`);
    }

    // Update output with final result
    const outputElement = card.querySelector(".tool-output");
    if (outputElement && result) {
      outputElement.textContent = this.formatResult(result, { includeImages: false });
      this.appendResultImages(outputElement, result);
    }
    showSavedOutput(card, result);

    // Collapse completed cards (less noise)
    if (!isError) {
      const body = card.querySelector(".tool-card-body");
      const chevron = card.querySelector(".tool-card-chevron");
      if (body) body.classList.remove("expanded");
      if (chevron) chevron.classList.remove("expanded");
    }
  }

  /**
   * Create a pre-collapsed card for session history using DOM methods (no innerHTML)
   */
  /**
   * @param {ToolExecution} toolExecution
   * @param {HTMLElement | null} [targetContainer]
   */
  createHistoryCard(toolExecution, targetContainer = null) {
    const { toolCallId, toolName, args } = toolExecution;

    const card = document.createElement("div");
    card.className = "tool-card";
    card.dataset.toolCallId = toolCallId;

    // Header
    const header = document.createElement("div");
    header.className = "tool-card-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "tool-header-left";

    const chevron = createToolChevron();
    headerLeft.appendChild(chevron);

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = displayToolName(toolName);
    name.title = toolName;
    headerLeft.appendChild(name);

    const preview = this.getArgsPreview(toolName, args);
    if (preview) {
      headerLeft.appendChild(createArgsPreview(preview, args));
    }

    header.appendChild(headerLeft);

    // Right side: copy button + status
    const headerRight = document.createElement("div");
    headerRight.className = "tool-header-right";

    const copyBtn = createToolCopyButton();
    headerRight.appendChild(copyBtn);

    const status = document.createElement("div");
    status.className = "tool-status complete";
    status.dataset.status = "complete";
    status.textContent = t("tools.complete");
    headerRight.appendChild(status);

    header.appendChild(headerRight);

    card.appendChild(header);

    // Body (collapsed by default)
    const body = document.createElement("div");
    body.className = "tool-card-body";

    const oldText = args?.oldText || args?.old_text;
    const newText = args?.newText || args?.new_text;
    const isEdit =
      (toolName === "edit" || toolName === "Edit") && Boolean(oldText) && Boolean(newText);

    if (isEdit && oldText && newText) {
      body.appendChild(this.renderDiff(oldText, newText));
    } else {
      const argsJson = this.formatJson(args);
      if (argsJson) {
        const argsEl = document.createElement("div");
        argsEl.className = "tool-args";
        argsEl.textContent = argsJson;
        body.appendChild(argsEl);
      }
    }

    const outputEl = document.createElement("div");
    outputEl.className = "tool-output";
    body.appendChild(outputEl);

    card.appendChild(body);

    (targetContainer || this.container)?.appendChild(card);
    this.toolCards.set(toolCallId, card);

    return card;
  }

  /**
   * Add result to a history card (stays collapsed)
   */
  /**
   * @param {string} toolCallId
   * @param {ToolResult | string | null | undefined} result
   * @param {boolean} isError
   */
  addHistoryResult(toolCallId, result, isError) {
    const card = this.toolCards.get(toolCallId);
    if (!card) return;

    if (isError) {
      const statusEl = card.querySelector(".tool-status");
      if (statusEl instanceof HTMLElement) {
        statusEl.className = "tool-status error";
        statusEl.dataset.status = "error";
        statusEl.textContent = t("tools.error");
      }
    }

    const outputElement = card.querySelector(".tool-output");
    if (outputElement && result) {
      outputElement.textContent = this.formatResult(result, { includeImages: false });
      this.appendResultImages(outputElement, result);
    }
    this.renderNestedRecord(card, nestedRecord(result));
    showSavedOutput(card, result);
  }

  /** Compact preview for the header line */
  /**
   * @param {string} _toolName
   * @param {ToolArgs | null | undefined} [args]
   */
  getArgsPreview(_toolName, args) {
    return toolArgsPreview(args);
  }

  /**
   * @param {ToolArgs | object | null | undefined} obj
   */
  formatJson(obj) {
    return formatToolJson(obj);
  }

  /** Render a hunk-level diff for Edit tool */
  /**
   * @param {string} oldText
   * @param {string} newText
   */
  renderDiff(oldText, newText) {
    return renderToolDiff(oldText, newText);
  }

  /**
   * @param {Element} outputElement
   * @param {ToolResult | string | null | undefined} result
   */
  appendResultImages(outputElement, result) {
    appendToolResultImages(outputElement, result);
  }

  /**
   * Live nested call under a parent card. No card is created for the child.
   * @param {string} parentId
   * @param {NestedCall} call
   */
  upsertNestedCall(parentId, call) {
    const card = this.toolCards.get(parentId);
    if (!card) return;
    const body = card.querySelector(".tool-card-body");
    if (!body) return;
    let list = body.querySelector(".tool-nested-calls");
    if (!list) {
      list = document.createElement("div");
      list.className = "tool-nested-calls";
      body.append(list);
    }
    const row = createNestedRow(call);
    const existing = [...list.querySelectorAll("[data-nested-id]")].find(
      (item) => item.getAttribute("data-nested-id") === call.id,
    );
    if (!existing) {
      list.append(row);
      return;
    }
    // Pi's end event has no args; keep the preview from the start.
    const priorArgs = existing.querySelector(".tool-nested-args");
    if (priorArgs && !row.querySelector(".tool-nested-args")) row.append(priorArgs);
    existing.replaceWith(row);
  }

  /**
   * @param {HTMLElement} card
   * @param {NestedCallRecord | null} record
   */
  renderNestedRecord(card, record) {
    renderNestedRecord(card, record);
  }

  /**
   * @param {ToolResult | string | null | undefined} result
   * @param {{ includeImages?: boolean }} [options]
   */
  formatResult(result, options) {
    return formatToolResult(result, options);
  }

  scrollToBottom() {
    if (this.container) chatFollow(this.container).follow();
  }

  expandAll() {
    this.toolCards.forEach((card) => {
      card.querySelector(".tool-card-body")?.classList.add("expanded");
      card.querySelector(".tool-card-chevron")?.classList.add("expanded");
    });
  }

  collapseAll() {
    this.toolCards.forEach((card) => {
      card.querySelector(".tool-card-body")?.classList.remove("expanded");
      card.querySelector(".tool-card-chevron")?.classList.remove("expanded");
    });
  }

  clear() {
    this.toolCards.forEach((card) => {
      card.remove();
    });
    this.toolCards.clear();
    this.liveTarget = null;
  }

  /**
   * New live cards go into this element (the running turn's work row) until it is cleared.
   * @param {HTMLElement | null} host
   */
  setLiveTarget(host) {
    this.liveTarget = host;
  }

  // Tear down the locale subscription and container listeners, drop tool-card
  // state, and release the container. Idempotent. clear() empties cards without
  // unsubscribing; destroy() is the full teardown used when a view is discarded.
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (typeof this.unsubscribeLocaleChange === "function") {
      this.unsubscribeLocaleChange();
      this.unsubscribeLocaleChange = null;
    }
    const onToggle = this._onContainerClickToggle;
    const onCopy = this._onContainerClickCopy;
    const onFileRef = this._onContainerClickFileRef;
    const onRun = this._onContainerClickRun;
    if (this.container) {
      if (onToggle) this.container.removeEventListener("click", onToggle);
      if (onCopy) this.container.removeEventListener("click", onCopy);
      if (onFileRef) this.container.removeEventListener("click", onFileRef);
      if (onRun) this.container.removeEventListener("click", onRun);
    }
    this._onContainerClickToggle = null;
    this._onContainerClickCopy = null;
    this._onContainerClickFileRef = null;
    this.toolCards.clear();
    this.container = null;
  }
}
