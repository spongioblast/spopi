// ABOUTME: Tests rpiv todo mirror.
// ABOUTME: Includes "recognizes rpiv-todo snapshots".
import { beforeEach, describe, expect, it } from "vitest";
import {
  isRpivTodoCommandNotify,
  isRpivTodoDetails,
  isRpivTodoWidgetRequest,
  RpivTodoMirrorPanel,
  replayRpivTodoFromMessages,
} from "./rpiv-todo-mirror.js";

describe("rpiv todo mirror", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("recognizes rpiv-todo snapshots", () => {
    expect(
      isRpivTodoDetails({
        tasks: [{ id: 1, subject: "Implement sync", status: "in_progress" }],
        nextId: 2,
      }),
    ).toBe(true);
    expect(
      isRpivTodoDetails({ tasks: [{ id: 1, subject: "bad", status: "open" }], nextId: 2 }),
    ).toBe(false);
  });

  it("replays the last todo tool result from messages", () => {
    const state = replayRpivTodoFromMessages([
      {
        role: "toolResult",
        toolName: "todo",
        details: { tasks: [{ id: 1, subject: "Old", status: "pending" }], nextId: 2 },
      },
      {
        role: "toolResult",
        toolName: "bash",
        details: { tasks: [{ id: 99, subject: "Ignored", status: "pending" }], nextId: 100 },
      },
      {
        role: "toolResult",
        toolName: "todo",
        details: { tasks: [{ id: 1, subject: "Done", status: "completed" }], nextId: 2 },
      },
    ]);

    expect(state).toEqual({ tasks: [{ id: 1, subject: "Done", status: "completed" }], nextId: 2 });
  });

  it("detects rpiv-todo extension UI requests", () => {
    expect(isRpivTodoWidgetRequest({ method: "setWidget", widgetKey: "rpiv-todos" })).toBe(true);
    expect(isRpivTodoWidgetRequest({ method: "setWidget", widgetKey: "other" })).toBe(false);
    expect(isRpivTodoCommandNotify("3/3 completed\n── Completed ──\n  ✓ #1 Done")).toBe(true);
    expect(isRpivTodoCommandNotify("regular message")).toBe(false);
  });

  it("renders a native panel from tool result details", () => {
    document.body.innerHTML = '<div class="input-area"><form></form></div>';
    const panel = new RpivTodoMirrorPanel({ container: document.querySelector(".input-area") });

    panel.applyToolResult({
      details: {
        tasks: [
          { id: 1, subject: "Build panel", status: "in_progress", activeForm: "building panel" },
          { id: 2, subject: "Deleted", status: "deleted" },
        ],
        nextId: 3,
      },
    });

    const element = document.querySelector(".rpiv-todo-panel");
    expect(element.classList.contains("hidden")).toBe(false);
    // Verify the heading includes the todo identifier (i18n key may be raw).
    expect(element.textContent.toLowerCase()).toContain("todos");
    expect(element.textContent).toContain("0/1");
    expect(element.textContent).toContain("Build panel");
    expect(element.textContent).not.toContain("Deleted");
  });

  it("reports whether anything is mirrored, so /todos is never a silent no-op", () => {
    document.body.innerHTML = '<div class="input-area"><form></form></div>';
    const panel = new RpivTodoMirrorPanel({ container: document.querySelector(".input-area") });

    expect(panel.hasVisibleTasks).toBe(false);

    panel.applyToolResult({
      details: { tasks: [{ id: 1, subject: "Gone", status: "deleted" }], nextId: 2 },
    });
    expect(panel.hasVisibleTasks).toBe(false);

    panel.applyToolResult({
      details: { tasks: [{ id: 1, subject: "Build panel", status: "pending" }], nextId: 2 },
    });
    expect(panel.hasVisibleTasks).toBe(true);
  });

  it("renders hover-expandable collapsed markup", () => {
    document.body.innerHTML = '<div class="input-area"><form></form></div>';
    const panel = new RpivTodoMirrorPanel({ container: document.querySelector(".input-area") });

    panel.applyToolResult({
      details: {
        tasks: [{ id: 1, subject: "Build panel", status: "pending" }],
        nextId: 2,
      },
    });

    const element = document.querySelector(".rpiv-todo-panel");
    expect(element.classList.contains("is-collapsed")).toBe(true);
    expect(element.querySelector(".rpiv-todo-panel__collapseIcon")).toBeNull();
    expect(element.querySelector(".rpiv-todo-panel__list").textContent).toContain("Build panel");
  });
});
