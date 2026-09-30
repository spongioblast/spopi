// ABOUTME: Tests the transcript's turn shape: prompt, one work row, then the answer.
// ABOUTME: Covers the per-turn Review card and the live row that never moves or drops a thought.
import { describe, expect, it, vi } from "vitest";
import { MessageRenderer } from "../ui/message-renderer.js";
import { createProcessDetailsGroup, summarizeProcessGroup } from "../ui/process-group.js";
import { ToolCardRenderer } from "../ui/tool-card.js";
import { createHistoryRenderer } from "./history-render.js";
import { registerTurnReview } from "./turn-block.js";
import { changedFilesInRange } from "./turn-files.js";

const messages = [
  { role: "user", entryId: "u1", content: "build it" },
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "w1",
        name: "write",
        arguments: { path: "app.js", content: "a\nb\n" },
      },
      { type: "toolCall", id: "w2", name: "write", arguments: { path: "bad.js", content: "x" } },
      { type: "toolCall", id: "r1", name: "read", arguments: { path: "README.md" } },
    ],
  },
  { role: "toolResult", toolCallId: "w1", content: "ok" },
  { role: "toolResult", toolCallId: "w2", content: "denied", isError: true },
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "e1",
        name: "edit",
        arguments: { path: "app.js", edits: [{ oldText: "b", newText: "c\nd" }] },
      },
    ],
  },
  { role: "toolResult", toolCallId: "e1", content: "ok" },
  { role: "assistant", content: [{ type: "text", text: "Done." }] },
  { role: "user", entryId: "u2", content: "thanks" },
  { role: "assistant", content: [{ type: "text", text: "Sure." }] },
];

function results() {
  return new Map(messages.filter((m) => m.role === "toolResult").map((m) => [m.toolCallId, m]));
}

describe("changedFilesInRange", () => {
  it("merges writes and edits per path and skips failed calls", () => {
    expect(changedFilesInRange(messages, 0, 7, results())).toEqual([
      { path: "app.js", add: 4, del: 1 },
    ]);
    expect(changedFilesInRange(messages, 7, 9, results())).toEqual([]);
  });
});

describe("renderHistory", () => {
  it("adds one Review card under the turn that wrote files", () => {
    const messagesElement = document.createElement("div");
    messagesElement.className = "messages";
    const append = (text) => {
      const node = document.createElement("div");
      node.textContent = text;
      if (text.startsWith("user:")) node.className = "message user";
      messagesElement.append(node);
      return node;
    };
    const renderer = createHistoryRenderer({
      workbench: {},
      messagesElement,
      extensionUi: { requeueForegroundPrompt: () => false },
      messageRenderer: {
        clear: () => messagesElement.replaceChildren(),
        renderWelcome: () => {},
        renderUserMessage: (message) => append(`user:${message.content}`),
        renderAssistantMessage: (message, _streaming, _history, target) => {
          const text = (message.content || []).map((b) => b.text || "").join("");
          if (target) return null;
          return append(`assistant:${text}`);
        },
        renderError: () => {},
        forceScrollToBottom: () => {},
      },
      toolRenderer: { clear: () => {}, createHistoryCard: () => {}, addHistoryResult: () => {} },
      captureExpandedProcessGroups: () => new Set(),
      createProcessDetailsGroup: () => {
        const wrapper = document.createElement("details");
        const body = document.createElement("div");
        wrapper.append(body);
        return {
          wrapper,
          body,
          setLabel: () => {},
          setStreaming: () => {},
          markDone: () => {},
          flagThinkingOnly: () => {},
        };
      },
      summarizeProcessGroup: () => "",
      logMessagesDom: () => {},
      t: (key) => key,
      getSessionId: () => "s",
      applyActiveSearchHighlight: () => 1,
      extractAssistantError: () => null,
      getLiveProcessGroup: () => null,
      setLiveProcessGroup: () => {},
    });
    const onReview = vi.fn();
    registerTurnReview(onReview);
    renderer.renderHistory(messages);
    const cards = messagesElement.querySelectorAll(".turn-block-review");
    expect(cards).toHaveLength(1);
    const card = cards[0].parentElement;
    expect(card?.previousElementSibling?.textContent).toBe("assistant:Done.");
    expect(card?.nextElementSibling?.textContent).toBe("user:thanks");
    /** @type {HTMLElement} */ (cards[0]).click();
    expect(onReview).toHaveBeenCalledWith({
      files: [{ path: "app.js", add: 4, del: 1 }],
      userEntryId: "u1",
      number: 1,
    });
  });
});

describe("live turn", () => {
  it("streams thinking and tools into one row and leaves the answer below it", () => {
    const messagesElement = document.createElement("div");
    document.body.append(messagesElement);
    const messageRenderer = new MessageRenderer(messagesElement);
    const toolRenderer = new ToolCardRenderer(messagesElement);
    /** @type {any} */
    let live = null;
    const renderer = createHistoryRenderer({
      workbench: {},
      messagesElement,
      extensionUi: { requeueForegroundPrompt: () => false },
      messageRenderer: /** @type {any} */ (messageRenderer),
      toolRenderer: /** @type {any} */ (toolRenderer),
      captureExpandedProcessGroups: () => new Set(),
      createProcessDetailsGroup,
      summarizeProcessGroup,
      logMessagesDom: () => {},
      t: (key) => key,
      getSessionId: () => "s",
      applyActiveSearchHighlight: () => 0,
      extractAssistantError: () => null,
      getLiveProcessGroup: () => live,
      setLiveProcessGroup: (group) => {
        live = group;
      },
    });
    messageRenderer.renderUserMessage({ role: "user", content: "fix it" });

    renderer.showLiveProcessIndicator();
    const step = /** @type {HTMLElement} */ (
      messageRenderer.renderAssistantMessage({ content: [] }, true)
    );
    renderer.adoptStreamingMessage(step);
    messageRenderer.updateStreamingMessage(step, [
      { type: "thinking", thinking: "look at app.js" },
    ]);
    messageRenderer.finalizeStreamingMessage(step);
    renderer.foldStepIntoLiveTurn(step);
    toolRenderer.createToolCard({
      toolCallId: "t1",
      toolName: "read",
      args: {},
      status: "pending",
    });

    renderer.showLiveProcessIndicator();
    const answer = /** @type {HTMLElement} */ (
      messageRenderer.renderAssistantMessage({ content: [] }, true)
    );
    renderer.adoptStreamingMessage(answer);
    messageRenderer.updateStreamingMessage(answer, [
      { type: "thinking", thinking: "now answer" },
      { type: "text", text: "Fixed." },
    ]);
    messageRenderer.finalizeStreamingMessage(answer);
    renderer.finishLiveTurn({ markDone: true });

    const kids = [...messagesElement.children];
    expect(kids.map((node) => node.className.split(" ").slice(0, 2).join(" "))).toEqual([
      "message user",
      "process-details-group done",
      "message assistant",
    ]);
    const row = kids[1];
    expect(row.querySelectorAll(".thinking-block")).toHaveLength(2);
    expect(row.textContent).toContain("look at app.js");
    expect(row.textContent).toContain("now answer");
    expect(row.querySelectorAll(".tool-card")).toHaveLength(1);
    expect(kids[2].textContent).toContain("Fixed.");
    expect(kids[2].querySelector(".thinking-block")).toBeNull();
    messagesElement.remove();
  });

  it("streams steps inside an opened row like a chat and puts the answer below it", () => {
    const messagesElement = document.createElement("div");
    document.body.append(messagesElement);
    const messageRenderer = new MessageRenderer(messagesElement);
    const toolRenderer = new ToolCardRenderer(messagesElement);
    /** @type {any} */
    let live = null;
    const renderer = createHistoryRenderer({
      workbench: {},
      messagesElement,
      extensionUi: { requeueForegroundPrompt: () => false },
      messageRenderer: /** @type {any} */ (messageRenderer),
      toolRenderer: /** @type {any} */ (toolRenderer),
      captureExpandedProcessGroups: () => new Set(),
      createProcessDetailsGroup,
      summarizeProcessGroup,
      logMessagesDom: () => {},
      t: (key) => key,
      getSessionId: () => "s",
      applyActiveSearchHighlight: () => 0,
      extractAssistantError: () => null,
      getLiveProcessGroup: () => live,
      setLiveProcessGroup: (group) => {
        live = group;
      },
    });
    messageRenderer.renderUserMessage({ role: "user", content: "fix it" });
    renderer.showLiveProcessIndicator();
    live.wrapper.querySelector(".process-details-toggle").click();

    const stepHost = renderer.streamHost();
    expect(stepHost).toBe(live.body);
    const step = /** @type {HTMLElement} */ (
      messageRenderer.renderAssistantMessage({ content: [] }, true, false, stepHost)
    );
    renderer.adoptStreamingMessage(step);
    messageRenderer.updateStreamingMessage(step, [
      { type: "thinking", thinking: "check the file" },
      { type: "text", text: "Looking at app.js first." },
    ]);
    const bodyKids = [...live.body.children].map((node) => node.className.split(" ")[0]);
    expect(bodyKids).toEqual(["thinking-block", "message"]);
    messageRenderer.finalizeStreamingMessage(step);
    renderer.foldStepIntoLiveTurn(step);

    const answer = /** @type {HTMLElement} */ (
      messageRenderer.renderAssistantMessage({ content: [] }, true, false, renderer.streamHost())
    );
    renderer.adoptStreamingMessage(answer);
    messageRenderer.updateStreamingMessage(answer, [{ type: "text", text: "Fixed." }]);
    expect(answer.parentElement).toBe(live.body);
    messageRenderer.finalizeStreamingMessage(answer);
    renderer.releaseAnswer(answer);
    const row = live.wrapper;
    renderer.finishLiveTurn({ markDone: true });

    expect(row.nextElementSibling).toBe(answer);
    expect(row.textContent).toContain("Looking at app.js first.");
    expect(row.textContent).not.toContain("Fixed.");
    messagesElement.remove();
  });

  it("keeps an answered question in place and continues the work in a new row below it", () => {
    const messagesElement = document.createElement("div");
    document.body.append(messagesElement);
    const messageRenderer = new MessageRenderer(messagesElement);
    const toolRenderer = new ToolCardRenderer(messagesElement);
    /** @type {any} */
    let live = null;
    const renderer = createHistoryRenderer({
      workbench: {},
      messagesElement,
      extensionUi: { requeueForegroundPrompt: () => false },
      messageRenderer: /** @type {any} */ (messageRenderer),
      toolRenderer: /** @type {any} */ (toolRenderer),
      captureExpandedProcessGroups: () => new Set(),
      createProcessDetailsGroup,
      summarizeProcessGroup,
      logMessagesDom: () => {},
      t: (key) => key,
      getSessionId: () => "s",
      applyActiveSearchHighlight: () => 0,
      extractAssistantError: () => null,
      getLiveProcessGroup: () => live,
      setLiveProcessGroup: (group) => {
        live = group;
      },
    });
    messageRenderer.renderUserMessage({ role: "user", content: "make it pink" });
    renderer.showLiveProcessIndicator();
    toolRenderer.createToolCard({ toolCallId: "t1", toolName: "read", args: {}, status: "done" });
    const firstRow = live.wrapper;
    const card = document.createElement("div");
    card.className = "inline-prompt-card answered";
    messagesElement.append(card);

    renderer.continueLiveTurnBelow(card);
    expect(live.wrapper).not.toBe(firstRow);
    toolRenderer.createToolCard({ toolCallId: "t2", toolName: "edit", args: {}, status: "done" });
    const answer = /** @type {HTMLElement} */ (
      messageRenderer.renderAssistantMessage({ content: [] }, true)
    );
    messageRenderer.updateStreamingMessage(answer, [{ type: "text", text: "Done." }]);
    messageRenderer.finalizeStreamingMessage(answer);
    renderer.finishLiveTurn({ markDone: true });

    const kids = [...messagesElement.children];
    expect(kids.indexOf(firstRow)).toBeLessThan(kids.indexOf(card));
    expect(kids.indexOf(card)).toBeLessThan(kids.indexOf(answer));
    expect(firstRow.querySelectorAll(".tool-card")).toHaveLength(1);
    const secondRow = kids[kids.indexOf(card) + 1];
    expect(secondRow.classList.contains("process-details-group")).toBe(true);
    expect(secondRow.querySelectorAll(".tool-card")).toHaveLength(1);

    renderer.continueLiveTurnBelow(null);
    messagesElement.remove();
  });
});
