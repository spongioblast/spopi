// ABOUTME: Tests the undone-turn marker and reading pi-workspace-history's undo and redo notices.
// ABOUTME: The marker names the turn after the last prompt left in the chat and offers Redo.
import { describe, expect, it, vi } from "vitest";
import { createUndoMarker, historyNotice } from "./undo-marker.js";

describe("historyNotice", () => {
  it("tells an undo with files from a chat-only undo, and spots a redo", () => {
    expect(historyNotice("Undo complete. Workspace restored to before that turn.")).toEqual({
      kind: "undo",
      filesKept: false,
    });
    expect(historyNotice("Undo complete. Conversation rewound; current files kept.")).toEqual({
      kind: "undo",
      filesKept: true,
    });
    expect(historyNotice("Redo complete. Workspace restored.")).toEqual({ kind: "redo" });
    expect(historyNotice("Nothing to undo.")).toBeNull();
    expect(historyNotice(undefined)).toBeNull();
  });
});

describe("createUndoMarker", () => {
  it("marks the turn after the last prompt left, runs redo, and clears", () => {
    const messages = document.createElement("div");
    const prompt = document.createElement("div");
    prompt.className = "message user";
    messages.append(prompt);
    const onRedo = vi.fn();
    const t = (/** @type {string} */ key, /** @type {any} */ params) =>
      params ? `${key}:${params.n}` : key;
    const marker = createUndoMarker({ messages, t, onRedo });

    marker.show({ filesKept: false });
    expect(messages.querySelector(".undo-marker-text")?.textContent).toBe(
      "chat.undone.withFiles:2",
    );
    marker.show({ filesKept: true });
    expect(messages.querySelectorAll(".undo-marker")).toHaveLength(1);
    expect(messages.querySelector(".undo-marker-text")?.textContent).toBe("chat.undone.chatOnly:2");

    messages.querySelector(".undo-marker-redo")?.dispatchEvent(new MouseEvent("click"));
    expect(onRedo).toHaveBeenCalled();
    marker.clear();
    expect(messages.querySelector(".undo-marker")).toBeNull();
  });

  it("goes away when the next prompt lands in the chat", async () => {
    const messages = document.createElement("div");
    const marker = createUndoMarker({ messages, t: (key) => key, onRedo: vi.fn() });
    marker.show({ filesKept: false });
    const reply = document.createElement("div");
    reply.className = "message assistant";
    messages.append(reply);
    await Promise.resolve();
    expect(messages.querySelector(".undo-marker")).not.toBeNull();
    const next = document.createElement("div");
    next.className = "message user";
    messages.append(next);
    await Promise.resolve();
    expect(messages.querySelector(".undo-marker")).toBeNull();
  });
});
