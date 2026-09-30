// ABOUTME: Tests selection-actions.js: the Edit and Ask Pi bar beside a selection.
// ABOUTME: A real CodeMirror view in jsdom; the actions are spies.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectionActions } from "./selection-actions.js";

/** @param {{ onEdit: () => unknown, onAsk: () => unknown }} actions */
function editorWith(actions) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    state: EditorState.create({
      doc: "alpha\nbeta\n",
      extensions: [selectionActions({ ...actions, t: (key) => key })],
    }),
    parent,
  });
}

describe("selectionActions", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows nothing without a selection and both actions with one", () => {
    const onEdit = vi.fn();
    const onAsk = vi.fn();
    const view = editorWith({ onEdit, onAsk });
    expect(view.dom.querySelector(".spopi-selection-actions")).toBeNull();
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    const bar = view.dom.querySelector(".spopi-selection-actions");
    const buttons = [...(bar?.querySelectorAll("button") ?? [])];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "editor.inlineEditRun",
      "editor.selectionAsk",
    ]);
    buttons[0].click();
    buttons[1].click();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onAsk).toHaveBeenCalledOnce();
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.dom.querySelector(".spopi-selection-actions")).toBeNull();
    view.destroy();
  });
});
