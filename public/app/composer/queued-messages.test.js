// ABOUTME: Tests queued messages.
// ABOUTME: Includes "hides the container when the queue is empty".
import { describe, expect, it, vi } from "vitest";
import { cancelQueuedMessage } from "../chat/stop-run.js";
import { renderQueuedMessages } from "./queued-messages.js";

describe("queued messages", () => {
  it("hides the container when the queue is empty", () => {
    const container = document.createElement("div");
    container.className = "queued-messages";

    renderQueuedMessages(container, { steering: [], followUp: [] });

    expect(container.classList.contains("hidden")).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it("renders steering and follow-up messages as text", () => {
    const container = document.createElement("div");
    container.className = "queued-messages hidden";

    renderQueuedMessages(container, {
      steering: ["Use the test fixture"],
      followUp: ["<script>alert('x')</script>"],
    });

    expect(container.classList.contains("hidden")).toBe(false);
    expect(container.querySelector(".queued-header")?.textContent).toContain(
      "composer.queue.header",
    );
    const rows = container.querySelectorAll(".queued-msg");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.dataset.kind).toBe("steer");
    expect(rows[1]?.dataset.kind).toBe("follow_up");
    expect(rows[0]?.querySelector(".queued-msg-kind")?.getAttribute("aria-label")).toBe(
      "composer.queuedSteering",
    );
    expect(rows[1]?.querySelector(".queued-msg-kind")?.getAttribute("aria-label")).toBe(
      "composer.queuedFollowUp",
    );
    expect(container.textContent).toContain("Use the test fixture");
    const followText = rows[1]?.querySelector(".queued-msg-text");
    expect(followText?.textContent).toBe("<script>alert('x')</script>");
    expect(followText?.innerHTML).toContain("&lt;script&gt;");
  });

  it("collapses and expands the list", () => {
    const container = document.createElement("div");
    renderQueuedMessages(container, { steering: ["one"], followUp: [] });
    container
      .querySelector(".queued-header")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector(".queued-header")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".queued-list")).toBeNull();
    container
      .querySelector(".queued-header")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector(".queued-list")).not.toBeNull();
  });

  it("uses icon buttons, with the interrupt hint on send now", () => {
    const container = document.createElement("div");
    renderQueuedMessages(container, { steering: ["hi there"], followUp: [] });
    for (const selector of [
      ".queued-msg-edit",
      ".queued-msg-send",
      ".queued-msg-cancel",
      ".queued-msg-grip",
    ]) {
      const button = container.querySelector(selector);
      expect(button?.classList.contains("ui-icon-button")).toBe(true);
      expect(button?.querySelector("svg")).not.toBeNull();
      expect(button?.getAttribute("aria-label")).toBeTruthy();
    }
    expect(container.querySelector(".queued-msg-send")?.title).toBe("composer.sendNowTitle");
    expect(container.querySelector(".queued-msg-cancel")?.getAttribute("aria-label")).toBe(
      "composer.removeQueued",
    );
  });

  it("reorders within a kind from the keyboard and not across kinds", () => {
    const moved = [];
    const container = document.createElement("div");
    renderQueuedMessages(
      container,
      { steering: ["first", "second"], followUp: ["later", "after"] },
      { onReorder: (item, to) => moved.push([item.message, to]) },
    );
    const rows = container.querySelectorAll(".queued-msg");
    rows[3]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
    );
    rows[0]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
    );
    rows[1]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    expect(moved).toEqual([["after", 0]]);
  });

  it("keeps focus on a moved row while Pi sends the queue back", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const actions = { onReorder: () => {} };
    renderQueuedMessages(container, { followUp: ["a", "b"] }, actions);
    const rows = container.querySelectorAll(".queued-msg");
    /** @type {HTMLElement} */ (rows[1]).focus();
    rows[1]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
    );
    renderQueuedMessages(container, { followUp: [] }, actions);
    renderQueuedMessages(container, { followUp: ["b"] }, actions);
    renderQueuedMessages(container, { followUp: ["b", "a"] }, actions);
    await Promise.resolve();
    expect(document.activeElement?.textContent).toContain("b");
    expect(document.activeElement?.classList.contains("queued-msg")).toBe(true);
    container.remove();
  });

  it("clicking × removes that row and re-queues the others", async () => {
    const sent = [];
    const runtime = {
      request: vi.fn(async (command) => {
        sent.push(command);
        if (command.type === "clear_queue") {
          return { data: { steering: ["keep", "drop"], followUp: ["later"] } };
        }
        return { success: true };
      }),
    };
    const container = document.createElement("div");
    renderQueuedMessages(
      container,
      { steering: ["keep", "drop"], followUp: ["later"] },
      {
        onCancel: (item) =>
          cancelQueuedMessage({
            runtime,
            target: { workspaceId: "w", sessionId: "s", instanceId: "i" },
            item,
            randomId: () => "key",
          }),
      },
    );
    container.querySelectorAll(".queued-msg-cancel")[1].click();
    await vi.waitFor(() =>
      expect(sent.map((command) => command.type)).toEqual(["clear_queue", "steer", "follow_up"]),
    );
    expect(sent[1].message).toBe("keep");
    expect(sent.map((command) => command.message)).not.toContain("drop");
    expect(sent[2].message).toBe("later");
  });

  it("edit moves the line into the composer and cancels the pill", () => {
    const input = document.createElement("textarea");
    input.id = "message-input";
    document.body.append(input);
    const cancelled = [];
    const container = document.createElement("div");
    document.body.append(container);
    renderQueuedMessages(
      container,
      { steering: ["Use the test fixture"], followUp: [] },
      {
        onCancel: (item) => cancelled.push(item.message),
      },
    );
    container
      .querySelector(".queued-msg-edit")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(input.value).toBe("Use the test fixture");
    expect(cancelled).toEqual(["Use the test fixture"]);
    input.remove();
    container.remove();
  });

  it("send now steers that pill", () => {
    const sent = [];
    const container = document.createElement("div");
    renderQueuedMessages(
      container,
      { steering: [], followUp: ["do this next"] },
      { onSendNow: (item) => sent.push(item) },
    );
    container
      .querySelector(".queued-msg-send")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sent).toEqual([
      { label: "composer.queuedFollowUp", message: "do this next", kind: "follow_up", index: 0 },
    ]);
  });
});
