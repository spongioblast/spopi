// ABOUTME: Tests context edits and unknown runtime events.
// ABOUTME: Includes "renders a context edit note and ignores an unknown history entry".
import { describe, expect, it, vi } from "vitest";
import { createHistoryRenderer } from "./history-render.js";
import { createRuntimeEventHandler } from "./runtime-events.js";

function t(key) {
  return key;
}

function renderer(messagesElement) {
  return createHistoryRenderer({
    workbench: {},
    messagesElement,
    extensionUi: { requeueForegroundPrompt: () => false },
    messageRenderer: {
      clear() {
        messagesElement.replaceChildren();
      },
      renderWelcome() {},
      renderUserMessage(message) {
        const node = document.createElement("div");
        node.className = "user";
        node.dataset.entryId = message.entryId;
        node.textContent = String(message.content);
        messagesElement.append(node);
        return node;
      },
      renderAssistantMessage() {
        return null;
      },
      renderError() {},
      forceScrollToBottom() {},
    },
    toolRenderer: { clear() {} },
    captureExpandedProcessGroups: () => new Set(),
    createProcessDetailsGroup: () => ({
      wrapper: document.createElement("div"),
      body: document.createElement("div"),
    }),
    summarizeProcessGroup: () => "",
    logMessagesDom: () => {},
    t,
    getSessionId: () => "session-a",
    applyActiveSearchHighlight: () => 1,
    extractAssistantError: () => null,
    getLiveProcessGroup: () => null,
    setLiveProcessGroup: () => {},
  });
}

describe("context edits and unknown runtime events", () => {
  it("renders a context edit note and ignores an unknown history entry", () => {
    const messagesElement = document.createElement("div");
    const { renderHistory } = renderer(messagesElement);
    expect(() =>
      renderHistory([
        { role: "user", content: "hello", entryId: "user-1" },
        { type: "context_edit", targetId: "user-1", replacement: null },
        { type: "future_thing" },
      ]),
    ).not.toThrow();
    expect(messagesElement.querySelector(".user").textContent).toBe("hello");
    expect(messagesElement.querySelector(".context-edit-note").textContent).toBe(
      "chat.contextEdit.omitted",
    );
  });

  it("logs an unknown runtime event once and does not throw", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const handle = createRuntimeEventHandler({
      metricsOverlay: { onRuntimeEvent() {}, phase: () => "idle" },
      workbench: { noteLensResult() {} },
      getTarget: () => ({}),
      sessionStatus: { isWaiting: () => false },
      t,
    });
    await handle({ type: "future_thing" });
    await handle({ type: "future_thing" });
    expect(debug).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });

  it("shows waiting while an extension prompt is open", async () => {
    const sessionStatus = {
      waiting: false,
      setWaiting(active) {
        this.waiting = active;
      },
      isWaiting() {
        return this.waiting;
      },
    };
    const handle = createRuntimeEventHandler({
      metricsOverlay: { onRuntimeEvent() {}, phase: () => "working" },
      workbench: { noteLensResult() {}, live: { show() {}, hide() {} } },
      getTarget: () => ({}),
      sessionStatus,
      t,
      setStatus: () => {},
      extensionUi: {
        handle(_target, event) {
          if (event.method === "select") expect(sessionStatus.waiting).toBe(true);
        },
      },
    });
    await handle({ type: "extension_ui_request", method: "select", id: "prompt-1" });
    expect(sessionStatus.waiting).toBe(false);
    sessionStatus.setWaiting(true);
    await handle({ type: "extension_ui_resolved", id: "prompt-1" });
    expect(sessionStatus.waiting).toBe(false);
    await handle({ type: "extension_ui_request", method: "notify", id: "note-1" });
    expect(sessionStatus.waiting).toBe(false);
  });
});
