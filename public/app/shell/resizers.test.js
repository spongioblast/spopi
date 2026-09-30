// ABOUTME: Tests the sidebar, chat, and dock splitters.
// ABOUTME: Drags start from the live layout and save once on release.
import { expect, test, vi } from "vitest";
import { mountLayoutResizers } from "./resizers.js";

/**
 * @param {EventTarget} target
 * @param {string} type
 * @param {{ clientX?: number, clientY?: number }} [at]
 */
function pointer(target, type, at = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...at }));
}

function setup() {
  const sidebarHandle = document.createElement("div");
  const dockHandle = document.createElement("div");
  document.body.append(sidebarHandle, dockHandle);
  let layout = { sidebarWidth: 240, chatWidthPct: 34, dockHeight: 300 };
  const onResize = vi.fn((patch) => {
    layout = { ...layout, ...patch };
  });
  const onCommit = vi.fn();
  mountLayoutResizers({
    sidebarHandle,
    dockHandle,
    getLayout: () => layout,
    onResize,
    onCommit,
  });
  return {
    sidebarHandle,
    dockHandle,
    onResize,
    onCommit,
    /** @param {Partial<typeof layout>} saved */
    load: (saved) => {
      layout = { ...layout, ...saved };
    },
  };
}

test("a drag after the saved layout loads starts from the saved width", () => {
  const { sidebarHandle, onResize, load } = setup();
  load({ sidebarWidth: 320 });
  pointer(sidebarHandle, "pointerdown", { clientX: 100 });
  pointer(window, "pointermove", { clientX: 130 });
  expect(onResize).toHaveBeenLastCalledWith({ sidebarWidth: 350 });
  pointer(window, "pointerup");
});

test("moves only resize; the layout is saved once when the drag ends", () => {
  const { dockHandle, onResize, onCommit } = setup();
  pointer(dockHandle, "pointerdown", { clientY: 500 });
  pointer(window, "pointermove", { clientY: 480 });
  pointer(window, "pointermove", { clientY: 450 });
  expect(onResize).toHaveBeenLastCalledWith({ dockHeight: 350 });
  expect(onCommit).not.toHaveBeenCalled();
  pointer(window, "pointerup");
  expect(onCommit).toHaveBeenCalledTimes(1);
  pointer(window, "pointermove", { clientY: 100 });
  expect(onResize).toHaveBeenCalledTimes(2);
});

test("a patch carries only the size being dragged, never the hidden flags", () => {
  const { sidebarHandle, onResize } = setup();
  pointer(sidebarHandle, "pointerdown", { clientX: 0 });
  pointer(window, "pointermove", { clientX: 10 });
  expect(Object.keys(onResize.mock.calls[0][0])).toEqual(["sidebarWidth"]);
  pointer(window, "pointerup");
});
