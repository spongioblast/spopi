// ABOUTME: Tests showContextMenu.
// ABOUTME: Includes "opens one menu and replaces the previous".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeContextMenu,
  createLongPress,
  registerContextMenuHost,
  showContextMenu,
} from "./context-menu.js";

function openAt(x, y, items) {
  return showContextMenu({
    event: { clientX: x, clientY: y, preventDefault() {} },
    items,
  });
}

afterEach(() => {
  closeContextMenu();
});

describe("showContextMenu", () => {
  it("opens one menu and replaces the previous", () => {
    openAt(20, 20, [{ label: "First", action() {} }]);
    openAt(40, 40, [{ label: "Second", action() {} }]);
    expect(document.querySelectorAll(".session-context-menu")).toHaveLength(1);
    expect(document.querySelector(".context-menu-item")?.textContent).toBe("Second");
  });

  it("clamps near the right edge", () => {
    const menu = openAt(window.innerWidth - 4, 10, [{ label: "Reveal in Explorer", action() {} }]);
    const left = Number.parseFloat(menu.style.left);
    expect(left).toBeLessThanOrEqual(window.innerWidth - 220);
  });

  it("closes on Escape and outside pointerdown", async () => {
    openAt(16, 16, [{ label: "Open", action() {} }]);
    expect(document.querySelector(".session-context-menu")).toBeTruthy();
    await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".session-context-menu")).toBeNull();

    openAt(16, 16, [{ label: "Open", action() {} }]);
    await Promise.resolve();
    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(document.querySelector(".session-context-menu")).toBeNull();
  });

  it("moves with the arrows and runs Enter on the focused item", async () => {
    const first = vi.fn();
    const second = vi.fn();
    openAt(16, 16, [
      { label: "Open", action: first },
      { label: "Rename", action: second },
    ]);
    await Promise.resolve();
    const items = [...document.querySelectorAll(".context-menu-item")];
    expect(document.activeElement).toBe(items[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(document.querySelector(".session-context-menu")).toBeNull();
  });
});

describe("long press", () => {
  let longPress;
  beforeEach(() => {
    longPress = createLongPress();
  });
  afterEach(() => {
    longPress.destroy();
    vi.useRealTimers();
    delete document.body.dataset.pointer;
  });

  it("fires only on a registered host and cancels after movement or scroll", () => {
    vi.useFakeTimers();
    document.body.dataset.pointer = "coarse";
    const host = document.createElement("button");
    const plain = document.createElement("button");
    registerContextMenuHost(host);
    document.body.append(host, plain);
    let opened = 0;
    host.addEventListener("contextmenu", () => {
      opened += 1;
    });
    plain.addEventListener("contextmenu", () => {
      opened += 1;
    });

    const pointer = (type, x, y) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: x });
      Object.defineProperty(event, "clientY", { value: y });
      return event;
    };
    plain.dispatchEvent(pointer("pointerdown", 0, 0));
    vi.advanceTimersByTime(500);
    expect(opened).toBe(0);

    host.dispatchEvent(pointer("pointerdown", 0, 0));
    document.dispatchEvent(pointer("pointermove", 20, 0));
    vi.advanceTimersByTime(500);
    expect(opened).toBe(0);

    host.dispatchEvent(pointer("pointerdown", 0, 0));
    document.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(500);
    expect(opened).toBe(0);

    host.dispatchEvent(pointer("pointerdown", 4, 4));
    vi.advanceTimersByTime(500);
    expect(opened).toBe(1);
    host.remove();
    plain.remove();
  });
});
