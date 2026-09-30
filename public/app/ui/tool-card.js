// ABOUTME: Renders collapsible tool execution cards and their streaming output.
// ABOUTME: Uses container-level event delegation so dynamically added cards need no per-element listeners.

const SVG_NS = "http://www.w3.org/2000/svg";

import { previewFile, runInTerminal } from "../chat/file-actions.js";
import { computeHunks, renderHunkList } from "../editor/merge-view.js";
import { onLocaleChange, t } from "../i18n/i18n.js";
import { chatFollow } from "./chat-follow.js";
import { copyText } from "./clipboard.js";

/**
 * @typedef {object} ToolArgs
 * @property {string} [path]
 * @property {string} [file_path]
 * @property {string} [filePath]
 * @property {string} [command]
 * @property {string} [query]
 * @property {string} [url]
 * @property {string} [oldText]
 * @property {string} [old_text]
 * @property {string} [newText]
 * @property {string} [new_text]
 */

/**
 * @typedef {object} ToolExecution
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {ToolArgs} [args]
 * @property {string} [status]
 * @property {string} [output]
 */

/**
 * @typedef {object} ToolResultContentBlock
 * @property {string} [type]
 * @property {string} [text]
 * @property {string} [data]
 * @property {string} [mimeType]
 */

/**
 * A screenshot is hundreds of KB of base64; the card names it instead of printing it.
 * @param {ToolResultContentBlock} block
 */
function imagePlaceholder(block) {
  const kb = Math.round(((block.data?.length ?? 0) * 3) / 4 / 1024);
  return `[image ${block.mimeType ?? ""}, ${kb} KB]`.replace(" ,", ",");
}

/**
 * @typedef {object} ToolResult
 * @property {ToolResultContentBlock[]} [content]
 * @property {{ spopiToolOutput?: { path?: unknown } }} [details]
 */

/**
 * Project-relative file where spopi-tool-output saved a long result, or "".
 * @param {ToolResult | string | null | undefined} result
 */
function savedOutputPath(result) {
  if (!result || typeof result !== "object") return "";
  const path = result.details?.spopiToolOutput?.path;
  return typeof path === "string" ? path : "";
}

/**
 * @param {ToolArgs | null | undefined} args
 */
function filePathFromArgs(args) {
  if (!args || typeof args !== "object") return "";
  /** @type {Array<"path" | "file_path" | "filePath">} */
  const keys = ["path", "file_path", "filePath"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

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
    const chevron = this._createChevron(isExpanded);
    headerLeft.appendChild(chevron);

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = toolName;
    headerLeft.appendChild(name);
    if (argsPreview) {
      headerLeft.appendChild(this._createArgsPreview(argsPreview, args));
    }
    header.appendChild(headerLeft);

    const headerRight = document.createElement("div");
    headerRight.className = "tool-header-right";
    headerRight.appendChild(this._createCopyButton());

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
   * @param {boolean} [expanded]
   */
  _createChevron(expanded = false) {
    const chevron = document.createElement("span");
    chevron.className = `tool-card-chevron${expanded ? " expanded" : ""}`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "8");
    svg.setAttribute("height", "8");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M2 1l4 3-4 3z");
    svg.appendChild(path);
    chevron.appendChild(svg);
    return chevron;
  }

  _createCopyButton() {
    const copyButton = document.createElement("button");
    copyButton.className = "tool-action-btn copy-output-btn";
    const label = t("tools.copyOutput");
    copyButton.title = label;
    copyButton.setAttribute("aria-label", label);

    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [name, value] of [
      ["width", "13"],
      ["height", "13"],
      ["viewBox", "0 0 24 24"],
      ["fill", "none"],
      ["stroke", "currentColor"],
      ["stroke-width", "2"],
      ["stroke-linecap", "round"],
      ["stroke-linejoin", "round"],
    ]) {
      svg.setAttribute(name, value);
    }
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", "14");
    rect.setAttribute("height", "14");
    rect.setAttribute("x", "8");
    rect.setAttribute("y", "8");
    rect.setAttribute("rx", "2");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2");
    svg.append(rect, path);
    copyButton.appendChild(svg);
    // Click handling is delegated to the container listener; no per-button
    // listener is needed here.
    return copyButton;
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
      const output = this.formatResult(result);
      outputElement.textContent = output;
    }
    this._showSavedOutput(card, result);

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

    const chevron = this._createChevron();
    headerLeft.appendChild(chevron);

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = toolName;
    headerLeft.appendChild(name);

    const preview = this.getArgsPreview(toolName, args);
    if (preview) {
      headerLeft.appendChild(this._createArgsPreview(preview, args));
    }

    header.appendChild(headerLeft);

    // Right side: copy button + status
    const headerRight = document.createElement("div");
    headerRight.className = "tool-header-right";

    const copyBtn = this._createCopyButton();
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
      outputElement.textContent = this.formatResult(result);
    }
    this._showSavedOutput(card, result);
  }

  /**
   * The card shows the full result; this line says the model got a digest and links the saved file.
   * @param {HTMLElement} card
   * @param {ToolResult | string | null | undefined} result
   */
  _showSavedOutput(card, result) {
    card.querySelector(".tool-output-saved")?.remove();
    const path = savedOutputPath(result);
    if (!path) return;
    const note = document.createElement("div");
    note.className = "tool-output-saved";
    const label = document.createElement("span");
    label.className = "tool-output-saved-label";
    label.textContent = t("tools.outputSaved");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "tool-file-ref";
    link.dataset.path = path;
    link.textContent = path;
    const preview = t("tools.openInPreview");
    link.title = preview;
    link.setAttribute("aria-label", `${preview}: ${path}`);
    note.append(label, link);
    card.querySelector(".tool-card-body")?.appendChild(note);
  }

  /** Compact preview for the header line */
  /**
   * @param {string} _toolName
   * @param {ToolArgs | null | undefined} [args]
   */
  getArgsPreview(_toolName, args) {
    if (!args || Object.keys(args).length === 0) return "";

    const filePath = filePathFromArgs(args);
    if (filePath) return filePath;

    // Show the most relevant arg inline
    if (args.command) return args.command.substring(0, 80);
    if (args.query) return args.query.substring(0, 60);
    if (args.url) return args.url;

    // Fallback: first string value
    for (const val of Object.values(args)) {
      if (typeof val === "string" && val.length > 0) {
        return val.substring(0, 60);
      }
    }
    return "";
  }

  /**
   * @param {string} previewText
   * @param {ToolArgs | null | undefined} args
   */
  _createArgsPreview(previewText, args) {
    const filePath = filePathFromArgs(args);
    if (filePath) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-args-preview tool-file-ref";
      button.dataset.path = filePath;
      button.textContent = previewText;
      const label = t("tools.openInPreview");
      button.title = label;
      button.setAttribute("aria-label", `${label}: ${filePath}`);
      return button;
    }
    if (args?.command) {
      const wrap = document.createElement("span");
      wrap.className = "tool-args-preview-wrap";
      const preview = document.createElement("span");
      preview.className = "tool-args-preview";
      preview.textContent = previewText;
      preview.title = String(args.command);
      const run = document.createElement("button");
      run.type = "button";
      run.className = "tool-action-btn tool-run-in-terminal";
      run.dataset.command = args.command;
      run.title = t("files.runInTerminal") || "Run in terminal";
      run.setAttribute("aria-label", run.title);
      run.textContent = "▶";
      wrap.append(preview, run);
      return wrap;
    }
    const preview = document.createElement("span");
    preview.className = "tool-args-preview";
    preview.textContent = previewText;
    preview.title = previewText;
    return preview;
  }

  /**
   * @param {ToolArgs | object | null | undefined} obj
   */
  formatJson(obj) {
    try {
      if (!obj || Object.keys(obj).length === 0) return "";
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  /** Render a hunk-level diff for Edit tool */
  /**
   * @param {string} oldText
   * @param {string} newText
   */
  renderDiff(oldText, newText) {
    const container = document.createElement("div");
    container.className = "tool-diff";
    renderHunkList(container, computeHunks(oldText || "", newText || ""));
    return container;
  }

  /**
   * @param {ToolResult | string | null | undefined} result
   */
  formatResult(result) {
    if (!result) return "";

    if (typeof result === "object" && result.content && Array.isArray(result.content)) {
      return (
        result.content
          .filter(Boolean)
          /**
           * @param {ToolResultContentBlock} block
           */
          .map((block) => {
            if (block.type === "text") return block.text;
            if (block.type === "image") return imagePlaceholder(block);
            return JSON.stringify(block);
          })
          .join("\n")
      );
    }

    return JSON.stringify(result, null, 2);
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
