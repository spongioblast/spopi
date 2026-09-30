// ABOUTME: Tests ConfigGateway.
// ABOUTME: The case titles in this file name what it checks.
import { describe, expect, it, vi } from "vitest";
import { ConfigGateway, consumeConfigResponseFrame } from "./config-gateway.js";

function createHarness() {
  const requests = [];
  const runtime = {
    request: vi.fn((command, target, options) => {
      requests.push({ command, target, options });
      return Promise.resolve({ acceptance: "accepted" });
    }),
  };
  const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };
  const gateway = new ConfigGateway({ runtime, getTarget: () => target });
  return { requests, runtime, gateway };
}

function idFromRequest(request) {
  const message = request.command.message;
  return JSON.parse(message.slice("/spopi-config ".length)).id;
}

describe("ConfigGateway", () => {
  it("waits for the active runtime target before sending startup configuration reads", async () => {
    let markReady;
    const ready = new Promise((resolve) => {
      markReady = resolve;
    });
    const waitUntilReady = () => ready;
    const runtime = { request: vi.fn().mockResolvedValue({ acceptance: "accepted" }) };
    const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };
    const gateway = new ConfigGateway({ runtime, getTarget: () => target, waitUntilReady });

    void gateway.call("get_default_thinking_level");
    void gateway.call("get_default_auto_compaction");
    await Promise.resolve();
    expect(runtime.request).not.toHaveBeenCalled();

    markReady();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledTimes(2));
  });

  it("invokes /spopi-config with an idempotency key and resolves on the matching notify", async () => {
    const { requests, gateway } = createHarness();
    const promise = gateway.call("list_model_catalog", { foo: 1 });
    expect(requests).toHaveLength(1);
    const { command, options } = requests[0];
    expect(command.type).toBe("prompt");
    expect(command.message.startsWith("/spopi-config ")).toBe(true);
    const payload = JSON.parse(command.message.slice("/spopi-config ".length));
    expect(payload).toMatchObject({ op: "list_model_catalog", params: { foo: 1 } });
    expect(options.idempotencyKey).toBe(payload.id);

    const consumed = gateway.consumeNotify({
      message: JSON.stringify({ __spopiConfig: payload.id, ok: true, data: { providers: [] } }),
    });
    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({ ok: true, data: { providers: [] } });
  });

  it("sends navigate_tree through the bridge command contract", async () => {
    const { requests, gateway } = createHarness();
    const promise = gateway.call("navigate_tree", {
      targetId: "leaf-9",
      summarize: false,
      label: "Resume branch",
    });
    const { command, options } = requests[0];
    const payload = JSON.parse(command.message.slice("/spopi-config ".length));
    expect(payload).toMatchObject({
      op: "navigate_tree",
      params: { targetId: "leaf-9", summarize: false, label: "Resume branch" },
    });
    expect(options.idempotencyKey).toBe(payload.id);
    gateway.consumeNotify({
      message: JSON.stringify({
        __spopiConfig: payload.id,
        ok: true,
        data: { cancelled: false },
      }),
    });
    await expect(promise).resolves.toEqual({ ok: true, data: { cancelled: false } });
  });

  it("consumes a config response carried by a background runtime frame", async () => {
    const { requests, gateway } = createHarness();
    const promise = gateway.call("generate_session_title");
    const id = idFromRequest(requests[0]);

    const consumed = consumeConfigResponseFrame(gateway, {
      type: "runtime_event",
      target: { workspaceId: "w", sessionId: "background-s", instanceId: "background-i" },
      event: {
        type: "extension_ui_request",
        method: "notify",
        message: JSON.stringify({ __spopiConfig: id, ok: true, data: { title: "Done" } }),
      },
    });

    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({ ok: true, data: { title: "Done" } });
  });

  it("ignores notifications that are not config responses", () => {
    const { gateway } = createHarness();
    expect(gateway.consumeNotify({ message: "hello world" })).toBe(false);
    expect(gateway.consumeNotify({ message: undefined })).toBe(false);
    expect(gateway.consumeNotify({ message: '{"__spopiConfig":123}' })).toBe(false);
  });

  it("swallows config responses even after the caller settled", async () => {
    const { requests, gateway } = createHarness();
    const promise = gateway.call("read_agent_config");
    const id = idFromRequest(requests[0]);
    gateway.consumeNotify({ message: JSON.stringify({ __spopiConfig: id, ok: true }) });
    await promise;
    // A duplicate/late notify for the same id is still recognized as ours.
    expect(
      gateway.consumeNotify({ message: JSON.stringify({ __spopiConfig: id, ok: true }) }),
    ).toBe(true);
  });

  it("rejects when the runtime request fails", async () => {
    const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };
    const runtime = { request: vi.fn(() => Promise.reject(new Error("runtime down"))) };
    const gateway = new ConfigGateway({ runtime, getTarget: () => target });
    await expect(gateway.call("list_model_catalog")).rejects.toThrow("runtime down");
  });

  it("times out when no response arrives", async () => {
    vi.useFakeTimers();
    try {
      const { gateway } = createHarness();
      const promise = gateway.call("generate_session_title", {}, { timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects when there is no active session target", async () => {
    const runtime = { request: vi.fn() };
    const gateway = new ConfigGateway({ runtime, getTarget: () => null });
    await expect(gateway.call("list_model_catalog")).rejects.toThrow("No active session");
  });
});
