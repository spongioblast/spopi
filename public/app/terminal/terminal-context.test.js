// ABOUTME: Tests terminalTextForChat.
// ABOUTME: Includes "prefers the selection over the tail and strips ANSI".
import { describe, expect, it, vi } from "vitest";
import { setComposerInsert } from "../composer/composer-actions.js";
import {
  dispatchTerminalToChat,
  formatTerminalPrompt,
  terminalTextForChat,
} from "./terminal-context.js";

const ESC = String.fromCharCode(27);

function tabWith({ selection = "", serialized = "" } = {}) {
  return {
    terminal: { getSelection: () => selection },
    serializeForCheckpoint: vi.fn(() => serialized),
  };
}

describe("terminalTextForChat", () => {
  it("prefers the selection over the tail and strips ANSI", () => {
    const tab = tabWith({
      selection: `${ESC}[32mselected${ESC}[0m`,
      serialized: "tail line",
    });
    expect(terminalTextForChat(tab)).toEqual({
      text: "selected",
      truncated: false,
      source: "selection",
    });
    expect(tab.serializeForCheckpoint).not.toHaveBeenCalled();
  });

  it("uses the last N lines of the screen when nothing is selected", () => {
    const serialized = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = terminalTextForChat(tabWith({ serialized }), { maxLines: 2 });
    expect(result).toEqual({ text: "line 4\nline 5", truncated: false, source: "tail" });
  });

  it("keeps the tail when the text exceeds the character cap", () => {
    const result = terminalTextForChat(tabWith({ serialized: "abcdef" }), { maxChars: 3 });
    expect(result).toEqual({ text: "def", truncated: true, source: "tail" });
  });

  it("reads the screen as plain text instead of the checkpoint", () => {
    const tab = { ...tabWith({ serialized: "unused" }), plainText: vi.fn(() => "$ node a.js") };
    expect(terminalTextForChat(tab, { maxLines: 50 }).text).toBe("$ node a.js");
    expect(tab.plainText).toHaveBeenCalledWith(50);
    expect(tab.serializeForCheckpoint).not.toHaveBeenCalled();
  });

  it("drops mode switches and titles from a checkpoint, not only colors", () => {
    const serialized = `${ESC}]0;MINGW64:/d/app\u0007${ESC}[32mAI@host${ESC}[m\n$ ${ESC}[?2004h${ESC}[?1004h`;
    expect(terminalTextForChat(tabWith({ serialized })).text).toBe("AI@host\n$ ");
  });
});

describe("formatTerminalPrompt", () => {
  it("fences the text and notes truncation before the fence", () => {
    expect(formatTerminalPrompt({ label: "Git Bash", text: "ls", truncated: false })).toBe(
      "Git Bash\n```text\nls\n```",
    );
    expect(formatTerminalPrompt({ label: "CMD", text: "dir", truncated: true })).toBe(
      "… (truncated)\nCMD\n```text\ndir\n```",
    );
  });
});

describe("dispatchTerminalToChat", () => {
  it("emits a terminal selection event with the label and no line numbers", () => {
    const handler = vi.fn();
    const unbind = setComposerInsert(handler);
    expect(dispatchTerminalToChat({ label: "Git Bash", text: "ls", truncated: false })).toBe(true);
    expect(handler.mock.calls[0][0]).toEqual({
      path: "Git Bash",
      text: "ls",
      kind: "terminal",
      truncated: false,
    });
    unbind();
  });
});
