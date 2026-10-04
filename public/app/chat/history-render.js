// ABOUTME: Draws turns as prompt, one work row, then the final answer, live and from history.
// ABOUTME: Runtime events stream into the live row; nothing is rearranged when a turn ends.

/**
 * @typedef {{
 *   type?: string,
 *   text?: string,
 *   id?: string,
 *   name?: string,
 *   arguments?: Record<string, unknown>,
 * }} HistoryContentBlock
 *
 * @typedef {{
 *   role?: string,
 *   type?: string,
 *   content?: string | HistoryContentBlock[],
 *   toolCallId?: string,
 *   isError?: boolean,
 *   usage?: unknown,
 *   timestamp?: number,
 *   entryId?: string,
 *   targetId?: string,
 *   replacement?: unknown,
 * }} HistoryEntry
 *
 * @typedef {{
 *   wrapper: HTMLElement,
 *   body: HTMLElement,
 *   setLabel: (text: string) => void,
 *   setStreaming: (isStreaming: boolean) => void,
 *   markDone: () => void,
 *   flagThinkingOnly: () => void,
 * }} ProcessDetailsGroup
 *
 * @typedef {{
 *   clear: () => void,
 *   createHistoryCard: (
 *     toolExecution: { toolCallId?: string, toolName?: string, args?: Record<string, unknown> },
 *     targetContainer?: HTMLElement | null,
 *   ) => void,
 *   addHistoryResult: (toolCallId?: string, result?: HistoryEntry, isError?: boolean) => void,
 *   setLiveTarget?: (host: HTMLElement | null) => void,
 * }} HistoryToolRenderer
 *
 * @typedef {{
 *   clear: () => void,
 *   renderWelcome: () => void,
 *   renderUserMessage: (message: HistoryEntry, isHistory?: boolean) => unknown,
 *   renderAssistantMessage: (
 *     message: unknown,
 *     isStreaming?: boolean,
 *     isHistory?: boolean,
 *     targetContainer?: HTMLElement | null,
 *   ) => HTMLElement | null | undefined | void,
 *   renderError: (errorMessage: string) => void,
 *   forceScrollToBottom: () => void,
 *   setThinkingHost?: (messageElement: HTMLElement, host: HTMLElement | null) => void,
 * }} HistoryMessageRenderer
 *
 * @typedef {{
 *   workbench: { setContextMessages?: (messages: HistoryEntry[]) => void },
 *   messagesElement: HTMLElement,
 *   extensionUi: { requeueForegroundPrompt: () => boolean },
 *   messageRenderer: HistoryMessageRenderer,
 *   toolRenderer: HistoryToolRenderer,
 *   captureExpandedProcessGroups: (container: ParentNode) => Set<number>,
 *   createProcessDetailsGroup: (options?: { expanded?: boolean }) => ProcessDetailsGroup,
 *   summarizeProcessGroup: (stepCount: number, toolCallCount: number) => string,
 *   logMessagesDom: (label: string, extra?: Record<string, unknown>) => void,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   getSessionId: () => string | null | undefined,
 *   applyActiveSearchHighlight: (options?: { scrollToFirst?: boolean }) => number,
 *   extractAssistantError: (
 *     message: HistoryEntry,
 *     options?: { fallback?: string },
 *   ) => string | null,
 *   getLiveProcessGroup: () => ProcessDetailsGroup | null,
 *   setLiveProcessGroup: (group: ProcessDetailsGroup | null) => void,
 * }} HistoryRendererDeps
 */

import { summarizeMessageRoles } from "../session/session-log.js";
import { forgetChangedPaths, mountReviewCard } from "./turn-block.js";
import { changedFilesInRange } from "./turn-files.js";

/**
 * @param {HistoryEntry[]} messages
 * @param {number} start
 * @param {number} end
 * @param {(message: HistoryEntry, options?: { fallback?: string }) => string | null} extractAssistantError
 * @param {string} fallback
 * @returns {string | null}
 */
function lastAssistantErrorInRange(messages, start, end, extractAssistantError, fallback) {
  for (let i = end - 1; i >= start; i -= 1) {
    if (messages[i]?.role === "assistant") {
      return extractAssistantError(messages[i], { fallback });
    }
  }
  return null;
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function assistantTextOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

/**
 * @param {unknown} content
 * @returns {{ processBlocks: HistoryContentBlock[], answerBlocks: HistoryContentBlock[] }}
 */
function splitFinalAssistantBlocks(content) {
  if (!Array.isArray(content)) return { processBlocks: [], answerBlocks: [] };
  let lastNonTextIdx = -1;
  for (let i = 0; i < content.length; i++) {
    if (content[i]?.type !== "text") lastNonTextIdx = i;
  }
  return {
    processBlocks: content.slice(0, lastNonTextIdx + 1),
    answerBlocks: content.slice(lastNonTextIdx + 1),
  };
}

/**
 * @param {HistoryContentBlock[]} blocks
 * @param {Map<string | undefined, HistoryEntry>} toolResults
 * @param {HTMLElement} targetContainer
 * @param {HistoryToolRenderer} toolRenderer
 * @returns {number}
 */
function renderToolCallBlocks(blocks, toolResults, targetContainer, toolRenderer) {
  let count = 0;
  for (const block of blocks) {
    if (block?.type !== "toolCall") continue;
    count += 1;
    toolRenderer.createHistoryCard(
      { toolCallId: block.id, toolName: block.name, args: block.arguments ?? {} },
      targetContainer,
    );
    const result = toolResults.get(block.id);
    if (result) toolRenderer.addHistoryResult(block.id, result, result.isError);
  }
  return count;
}

/**
 * @param {HistoryRendererDeps} options
 */
export function createHistoryRenderer({
  workbench,
  messagesElement,
  extensionUi,
  messageRenderer,
  toolRenderer,
  captureExpandedProcessGroups,
  createProcessDetailsGroup,
  summarizeProcessGroup,
  logMessagesDom,
  t,
  getSessionId,
  applyActiveSearchHighlight,
  extractAssistantError,
  getLiveProcessGroup,
  setLiveProcessGroup,
}) {
  /**
   * @param {unknown} entries
   * @returns {boolean}
   */
  function renderHistory(entries) {
    const messages = /** @type {HistoryEntry[]} */ (
      (Array.isArray(entries) ? entries : []).filter((entry) => entry?.role)
    );
    const contextEdits = /** @type {HistoryEntry[]} */ (
      (Array.isArray(entries) ? entries : []).filter((entry) => entry?.type === "context_edit")
    );
    workbench.setContextMessages?.(messages);
    console.info("[spopi] session load: renderHistory start", {
      sessionId: getSessionId(),
      messageCount: messages.length,
      roles: summarizeMessageRoles(messages),
      existingChildCount: messagesElement?.children?.length ?? null,
    });
    const hadInFlightPrompt = extensionUi.requeueForegroundPrompt();
    const expandedProcessGroups = captureExpandedProcessGroups(messagesElement);
    messageRenderer.clear();
    toolRenderer.clear();
    forgetChangedPaths();
    setLiveProcessGroup(null);
    if (messages.length === 0) {
      messageRenderer.renderWelcome();
      applyActiveSearchHighlight({ scrollToFirst: false });
      logMessagesDom("renderHistory empty", { sessionId: getSessionId() });
      return hadInFlightPrompt;
    }

    /** @type {Map<string | undefined, HistoryEntry>} */
    const toolResults = new Map();
    for (const message of messages) {
      if (message.role === "toolResult") toolResults.set(message.toolCallId, message);
    }

    /** @type {Array<[number, number]>} */
    const turns = [];
    let turnStart = 0;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "user" && i !== turnStart) {
        turns.push([turnStart, i]);
        turnStart = i;
      }
    }
    turns.push([turnStart, messages.length]);

    let processGroupIndex = 0;
    for (const [start, end] of turns) {
      const anchor = messages[start];
      let bodyStart = start;
      if (anchor.role === "user") {
        messageRenderer.renderUserMessage(anchor, true);
        bodyStart = start + 1;
      }

      let finalAssistantIdx = -1;
      for (let i = end - 1; i >= bodyStart; i--) {
        if (messages[i].role === "assistant" && assistantTextOf(messages[i].content)) {
          finalAssistantIdx = i;
          break;
        }
      }

      /** @type {ProcessDetailsGroup | null} */
      let group = null;
      let stepCount = 0;
      let toolCallCount = 0;
      const ensureGroup = () => {
        if (!group) {
          group = createProcessDetailsGroup({
            expanded: expandedProcessGroups.has(processGroupIndex),
          });
          processGroupIndex += 1;
          messagesElement.appendChild(group.wrapper);
        }
        return group;
      };

      for (let i = bodyStart; i < end; i++) {
        const message = messages[i];
        if (message.role !== "assistant") continue;
        if (i === finalAssistantIdx) {
          const { processBlocks, answerBlocks } = splitFinalAssistantBlocks(message.content);
          const isUnterminatedTurn = answerBlocks.length === 0 && i === messages.length - 1;
          if (isUnterminatedTurn) {
            const leadingText = processBlocks.filter((b) => b.type === "text");
            if (leadingText.length > 0) {
              messageRenderer.renderAssistantMessage(
                {
                  content: leadingText,
                  usage: message.usage,
                  timestamp: message.timestamp,
                  entryId: message.entryId,
                },
                false,
                true,
              );
            }
            const remainingProcessBlocks = processBlocks.filter((b) => b.type !== "text");
            if (remainingProcessBlocks.some((b) => b.type === "thinking")) {
              const el = messageRenderer.renderAssistantMessage(
                { content: remainingProcessBlocks, usage: message.usage },
                false,
                true,
                ensureGroup().body,
              );
              if (el) stepCount += 1;
            }
            if (remainingProcessBlocks.some((b) => b.type === "toolCall")) {
              toolCallCount += renderToolCallBlocks(
                remainingProcessBlocks,
                toolResults,
                ensureGroup().body,
                toolRenderer,
              );
            }
          } else {
            if (processBlocks.some((b) => b.type === "text" || b.type === "thinking")) {
              const el = messageRenderer.renderAssistantMessage(
                { content: processBlocks, usage: message.usage },
                false,
                true,
                ensureGroup().body,
              );
              if (el) stepCount += 1;
            }
            if (processBlocks.some((b) => b.type === "toolCall")) {
              toolCallCount += renderToolCallBlocks(
                processBlocks,
                toolResults,
                ensureGroup().body,
                toolRenderer,
              );
            }
          }
          if (answerBlocks.length > 0) {
            messageRenderer.renderAssistantMessage(
              {
                content: answerBlocks,
                usage: message.usage,
                timestamp: message.timestamp,
                entryId: message.entryId,
              },
              false,
              true,
            );
          }
        } else {
          const processGroup = ensureGroup();
          const el = messageRenderer.renderAssistantMessage(
            message,
            false,
            true,
            processGroup.body,
          );
          if (el) stepCount += 1;
          toolCallCount += renderToolCallBlocks(
            /** @type {HistoryContentBlock[]} */ (message.content ?? []),
            toolResults,
            processGroup.body,
            toolRenderer,
          );
        }
      }

      const turnError = lastAssistantErrorInRange(
        messages,
        bodyStart,
        end,
        extractAssistantError,
        t("messages.providerError"),
      );
      if (turnError) messageRenderer.renderError(turnError);
      const turnGroup = /** @type {ProcessDetailsGroup | null} */ (group);
      if (turnGroup) {
        if (turnGroup.body.children.length > 0) {
          turnGroup.setLabel(summarizeProcessGroup(stepCount, toolCallCount));
          turnGroup.flagThinkingOnly();
        } else turnGroup.wrapper.remove();
      }
      mountReviewCard(
        messagesElement,
        {
          files: changedFilesInRange(messages, bodyStart, end, toolResults),
          userEntryId: anchor.role === "user" ? anchor.entryId : undefined,
        },
        t,
      );
    }

    const highlighted = applyActiveSearchHighlight();
    renderContextEdits(contextEdits);
    if (highlighted === 0) messageRenderer.forceScrollToBottom();
    logMessagesDom("renderHistory complete", {
      sessionId: getSessionId(),
      inputCount: messages.length,
      turnCount: turns.length,
      highlighted,
    });
    return hadInFlightPrompt;
  }

  /**
   * @param {HistoryEntry[]} edits
   */
  function renderContextEdits(edits) {
    for (const edit of edits) {
      const targetId = edit?.targetId;
      if (!targetId || !messagesElement) continue;
      const anchor = messagesElement.querySelector(
        `[data-entry-id="${String(targetId).replaceAll('"', "")}"]`,
      );
      const note = document.createElement("div");
      note.className = "context-edit-note";
      note.textContent =
        edit.replacement == null ? t("chat.contextEdit.omitted") : t("chat.contextEdit.replaced");
      if (anchor) anchor.after(note);
      else messagesElement.append(note);
    }
  }

  /**
   * The running turn's work row. It is created once, right after the prompt, and never
   * moves. Thinking and tool cards stream into it; only the final answer sits below it.
   */
  function showLiveProcessIndicator() {
    if (getLiveProcessGroup()?.wrapper.isConnected) return;
    const live = createProcessDetailsGroup();
    live.setLabel(t("chat.live.thinking"));
    live.setStreaming(true);
    setLiveProcessGroup(live);
    messagesElement.appendChild(live.wrapper);
    toolRenderer.setLiveTarget?.(live.body);
    messageRenderer.forceScrollToBottom();
  }

  /**
   * Where a new step's text streams. An opened row is a live chat of the work, so text
   * streams inside it; a closed row keeps the text below it, where it can be read.
   * @returns {HTMLElement | null}
   */
  function streamHost() {
    const live = getLiveProcessGroup();
    if (!live?.wrapper.isConnected) return null;
    return live.wrapper.classList.contains("expanded") ? live.body : null;
  }

  /**
   * The final answer belongs below the row, even if it streamed inside an opened row.
   * @param {HTMLElement | null | undefined} element
   */
  function releaseAnswer(element) {
    const live = getLiveProcessGroup();
    if (!element?.isConnected || !live || element.parentElement !== live.body) return;
    live.wrapper.after(element);
  }

  /**
   * @param {HTMLElement | null | undefined} element a streaming assistant message
   */
  function adoptStreamingMessage(element) {
    const live = getLiveProcessGroup();
    if (!element || !live) return;
    messageRenderer.setThinkingHost?.(element, live.body);
  }

  /**
   * A step that ended in a tool call is work, not the answer: its text joins the row.
   * @param {HTMLElement | null | undefined} element
   */
  function foldStepIntoLiveTurn(element) {
    const live = getLiveProcessGroup();
    if (!element?.isConnected || !live) return;
    live.body.appendChild(element);
  }

  /**
   * An answered question splits the running turn. The work so far stays in the row
   * above the card; a new row below it takes what follows, so the card keeps its place
   * instead of sinking under everything Pi does next.
   * @param {Element | null | undefined} anchor the answered card
   */
  function continueLiveTurnBelow(anchor) {
    const live = getLiveProcessGroup();
    if (!live?.wrapper.isConnected || !anchor?.isConnected) return;
    const after = live.wrapper.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!after) return;
    finishLiveTurn({ markDone: false });
    showLiveProcessIndicator();
  }

  /** @param {string} text */
  function setLiveStep(text) {
    const live = getLiveProcessGroup();
    if (live && text) live.setLabel(text);
  }

  /**
   * The turn ended: the row stops pulsing and names what happened. Nothing is moved.
   * @param {{ markDone?: boolean }} [options]
   */
  function finishLiveTurn({ markDone = true } = {}) {
    const live = getLiveProcessGroup();
    toolRenderer.setLiveTarget?.(null);
    setLiveProcessGroup(null);
    if (!live) return;
    const body = live.body;
    const toolCallCount = body.querySelectorAll(":scope > .tool-card").length;
    const stepCount = body.querySelectorAll(
      ":scope > .thinking-block, :scope > .message.assistant",
    ).length;
    if (stepCount + toolCallCount === 0) {
      live.wrapper.remove();
      return;
    }
    live.setLabel(summarizeProcessGroup(stepCount, toolCallCount));
    live.flagThinkingOnly();
    if (markDone) live.markDone();
    else live.setStreaming(false);
  }

  return {
    renderHistory,
    showLiveProcessIndicator,
    streamHost,
    releaseAnswer,
    adoptStreamingMessage,
    foldStepIntoLiveTurn,
    continueLiveTurnBelow,
    setLiveStep,
    finishLiveTurn,
  };
}

/**
 * Snapshot hydration renders through the store. Live token updates stay on the
 * event path so a streaming delta does not rebuild the column.
 * @param {{
 *   subscribe: (fn: (state: { transcript: { messages: unknown[] } }, action: { type?: string, messages?: unknown[] }) => void) => unknown,
 *   lastHistoryResult?: unknown,
 * }} runtime
 * @param {(messages: unknown[]) => unknown} render
 */
export function watchTranscript(runtime, render) {
  return runtime.subscribe((state, action) => {
    if (action?.type !== "snapshot") return;
    const messages = action.messages ?? state.transcript.messages;
    runtime.lastHistoryResult = render(messages);
  });
}
