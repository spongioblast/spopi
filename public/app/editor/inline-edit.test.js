// ABOUTME: Tests inline-edit.js: the prompt text, fences, fitting the answer, and applying it.
// ABOUTME: Applying uses a small fake EditorView; the model call is a stub.
import { describe, expect, it, vi } from "vitest";
import {
  applyInlineEdit,
  buildInlinePrompt,
  fitToSelection,
  mountInlineEditPrompt,
  requestInlineEdit,
  stripFences,
} from "./inline-edit.js";

/** @param {string} doc */
function fakeView(doc) {
  const view = {
    doc,
    dispatched: /** @type {any[]} */ ([]),
    focus: vi.fn(),
    state: {
      sliceDoc: (/** @type {number} */ from, /** @type {number} */ to) => view.doc.slice(from, to),
    },
    dispatch(/** @type {any} */ spec) {
      const { from, to, insert } = spec.changes;
      view.doc = view.doc.slice(0, from) + insert + view.doc.slice(to);
      view.dispatched.push(spec);
    },
  };
  return view;
}

describe("buildInlinePrompt", () => {
  it("keeps path, lines, instruction, then selection", () => {
    expect(
      buildInlinePrompt({
        path: "src/a.rs",
        startLine: 2,
        endLine: 3,
        text: "let x = 1;",
        instruction: "rename x",
      }),
    ).toBe("FILE: src/a.rs\nLINES: 2-3\nINSTRUCTION:\nrename x\n\nSELECTION:\nlet x = 1;\n");
  });
});

describe("stripFences", () => {
  it("removes a language fence when the model wraps the edit", () => {
    expect(stripFences("```rs\nfn x() {}\n```")).toBe("fn x() {}");
  });

  it("keeps the indentation inside a fence", () => {
    expect(stripFences("```js\n  a();\n  b();\n```")).toBe("  a();\n  b();");
  });
});

describe("fitToSelection", () => {
  it("keeps the blank line the selection ended on", () => {
    expect(fitToSelection("function a() {\n}\n", "function b() {\n}")).toBe("function b() {\n}\n");
  });

  it("keeps the first line's indentation and drops the model's extra blank lines", () => {
    expect(fitToSelection("  const x = 1;", "\n  const y = 1;\n\n")).toBe("  const y = 1;");
  });

  it("gives back the original unchanged when the model repeats it", () => {
    const original = "  a();\n";
    expect(fitToSelection(original, "  a();")).toBe(original);
  });
});

describe("applyInlineEdit", () => {
  it("replaces the selection as one change, selects it, and saves", () => {
    const view = fakeView("head\nold\ntail");
    const onSave = vi.fn();
    const applied = applyInlineEdit(/** @type {any} */ (view), {
      from: 5,
      to: 8,
      original: "old",
      replacement: "new",
      onSave,
    });
    expect(applied).toBe(true);
    expect(view.doc).toBe("head\nnew\ntail");
    expect(view.dispatched).toHaveLength(1);
    expect(view.dispatched[0].selection).toEqual({ anchor: 5, head: 8 });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("refuses when the selected text changed meanwhile", () => {
    const view = fakeView("head\nOLD\ntail");
    const onSave = vi.fn();
    expect(
      applyInlineEdit(/** @type {any} */ (view), {
        from: 5,
        to: 8,
        original: "old",
        replacement: "new",
        onSave,
      }),
    ).toBe(false);
    expect(view.doc).toBe("head\nOLD\ntail");
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("mountInlineEditPrompt", () => {
  it("runs on Enter, cancels on Escape, and shows a message", () => {
    const root = document.createElement("div");
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const prompt = mountInlineEditPrompt(root, { onSubmit, onCancel });
    if (!prompt) throw new Error("no prompt");
    prompt.input.value = "rename";
    prompt.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSubmit).toHaveBeenCalledWith("rename");
    prompt.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    prompt.setBusy(true);
    expect(prompt.run.disabled).toBe(true);
    prompt.showMessage("No change");
    expect(root.querySelector(".inline-edit-message")?.textContent).toBe("No change");
  });
});

describe("requestInlineEdit", () => {
  it("asks the live Pi process and strips fences", async () => {
    const modelCall = vi.fn(async () => ({ text: "```\nfn y() {}\n```" }));
    const text = await requestInlineEdit({
      prompt: "p",
      modelCall,
    });
    expect(text).toBe("fn y() {}");
    expect(modelCall).toHaveBeenCalledWith("inline_edit", expect.objectContaining({ prompt: "p" }));
  });

  it("refuses to call a removed host route when no model call is wired", async () => {
    await expect(requestInlineEdit({ prompt: "p" })).rejects.toThrow(/live Pi process/);
  });
});
