// ABOUTME: Tests the queue mode selects.
// ABOUTME: Changing a select writes the default and the live session.
import { describe, expect, it, vi } from "vitest";
import { queueModeControls } from "./queue-modes.js";

describe("queueModeControls", () => {
  it("writes steering mode through the bridge and RPC", async () => {
    const configGateway = { call: vi.fn(async () => ({ ok: true, data: {} })) };
    const runtime = { request: vi.fn(async () => ({})) };
    const root = document.createElement("div");
    root.append(
      ...queueModeControls({ configGateway, runtime, getTarget: () => ({ sessionId: "s" }) }),
    );
    document.body.append(root);
    const select = /** @type {HTMLSelectElement} */ (
      document.getElementById("queue-steering-mode")
    );
    select.value = "all";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(configGateway.call).toHaveBeenCalledWith("set_queue_mode", {
        kind: "steering",
        mode: "all",
      });
    });
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "set_steering_mode", mode: "all" },
      { sessionId: "s" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    root.remove();
  });
});
