// ABOUTME: Tests formatContextChip.
// ABOUTME: Includes "uses the file name and a single line".
import { describe, expect, it, vi } from "vitest";
import { setComposerInsert } from "../composer/composer-actions.js";
import {
  dispatchSelectionToChat,
  formatContextChip,
  formatSelectionMention,
  formatSelectionPrompt,
  selectionFromEditor,
} from "./editor-context.js";

describe("formatSelectionMention", () => {
  it("links the file and its line range", () => {
    expect(formatSelectionMention({ path: "src/todo.js", startLine: 1, endLine: 9 })).toBe(
      "@src/todo.js:1-9",
    );
    expect(formatSelectionMention({ path: "src/todo.js", startLine: 4, endLine: 4 })).toBe(
      "@src/todo.js:4",
    );
  });

  it("quotes a path the plain token cannot carry", () => {
    expect(formatSelectionMention({ path: "my dir/a.js", startLine: 2, endLine: 3 })).toBe(
      '@"my dir/a.js":2-3',
    );
  });
});

describe("formatContextChip", () => {
  it("uses the file name and a single line", () => {
    expect(formatContextChip({ path: "D:/app/src/main.rs", startLine: 12, endLine: 12 })).toBe(
      "main.rs:12",
    );
  });

  it("uses a range when the selection spans lines", () => {
    expect(formatContextChip({ path: "public/app/app.js", startLine: 10, endLine: 18 })).toBe(
      "app.js:10-18",
    );
  });
});

describe("formatSelectionPrompt", () => {
  it("wraps the selection in a fenced block under the chip", () => {
    expect(
      formatSelectionPrompt({
        path: "src/lib.rs",
        startLine: 3,
        endLine: 4,
        text: "fn x() {}\n",
      }),
    ).toBe("Look at this selection.\n\nlib.rs:3-4\n```\nfn x() {}\n\n```");
  });

  it("omits line numbers for a terminal capture", () => {
    expect(formatSelectionPrompt({ kind: "terminal", path: "Git Bash", text: "ls\n" })).toBe(
      "Git Bash\n```text\nls\n\n```",
    );
    expect(formatContextChip({ kind: "terminal", path: "CMD", startLine: 12, endLine: 40 })).toBe(
      "CMD",
    );
  });
});

describe("selectionFromEditor", () => {
  it("returns null without a view or a non-empty range", () => {
    expect(selectionFromEditor(null)).toBeNull();
    expect(
      selectionFromEditor({
        view: {
          state: {
            selection: { main: { from: 4, to: 4 } },
            doc: { lineAt: () => ({ number: 1 }) },
            sliceDoc: () => "",
          },
        },
      }),
    ).toBeNull();
  });

  it("reads line numbers and text from the main range", () => {
    const doc = {
      lineAt(pos) {
        return { number: pos < 5 ? 1 : 2 };
      },
    };
    const selection = selectionFromEditor({
      view: {
        state: {
          selection: { main: { from: 0, to: 8 } },
          doc,
          sliceDoc: (from, to) => `CHUNK:${from}-${to}`,
        },
      },
    });
    expect(selection).toEqual({ startLine: 1, endLine: 2, text: "CHUNK:0-8" });
  });
});

describe("dispatchSelectionToChat", () => {
  it("emits the window event when text is present", () => {
    const handler = vi.fn();
    const unbind = setComposerInsert(handler);
    expect(dispatchSelectionToChat({ text: "hi", path: "a.js", startLine: 1, endLine: 1 })).toBe(
      true,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].text).toBe("hi");
    unbind();
  });
});
