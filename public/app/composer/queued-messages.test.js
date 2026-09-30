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
    expect(container.querySelectorAll(".queued-msg")).toHaveLength(2);
    expect(container.textContent).toContain("composer.queuedSteering");
    expect(container.textContent).toContain("Use the test fixture");
    expect(container.textContent).toContain("composer.queuedFollowUp");
    expect(container.innerHTML).not.toContain("<script>");
  });

  it("uses the shared compact buttons, with an icon for remove", () => {
    const container = document.createElement("div");
    renderQueuedMessages(container, { steering: ["hi there"], followUp: [] });
    for (const selector of [".queued-msg-edit", ".queued-msg-send"]) {
      expect(container.querySelector(selector)?.classList.contains("ui-button")).toBe(true);
    }
    const remove = container.querySelector(".queued-msg-cancel");
    expect(remove?.classList.contains("ui-icon-button")).toBe(true);
    expect(remove?.querySelector("svg")).not.toBeNull();
    expect(remove?.getAttribute("aria-label")).toBe("composer.removeQueued");
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
