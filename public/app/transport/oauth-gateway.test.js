// ABOUTME: Tests the OAuth gateway's pending association, terminal settling,
// ABOUTME: unknown-frame swallowing, and the command/response contract.

import { describe, expect, it, vi } from "vitest";
import { createOauthGateway } from "./oauth-gateway.js";

function createHarness() {
  const requests = [];
  const runtime = {
    request: vi.fn((command, target, options) => {
      requests.push({ command, target, options });
      return Promise.resolve({ acceptance: "accepted" });
    }),
  };
  const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };
  const gateway = createOauthGateway({ runtime, getTarget: () => target });
  return { requests, runtime, gateway, target };
}

function eventEnvelope(configId, event) {
  return {
    type: "runtime_event",
    target: { workspaceId: "w", sessionId: "s", instanceId: "i" },
    event: {
      type: "extension_ui_request",
      method: "notify",
      message: JSON.stringify({ __spopiOauth: configId, event }),
    },
  };
}

// The bridge settles every /spopi-config command with a __spopiConfig frame
// tagged with the initiating request id (spopi-bridge.ts respond()).
function responseEnvelope(configId, payload) {
  return {
    type: "runtime_event",
    target: { workspaceId: "w", sessionId: "s", instanceId: "i" },
    event: {
      type: "extension_ui_request",
      method: "notify",
      message: JSON.stringify({ __spopiConfig: configId, ...payload }),
    },
  };
}

describe("createOauthGateway", () => {
  it("sends a v3-shaped command over /spopi-config and resolves the response frame", async () => {
    const { requests, gateway } = createHarness();
    const promise = gateway.command({
      type: "start_oauth_login",
      provider: "openai-codex",
      method: "device_code",
    });

    const sent = requests[0].command;
    expect(sent.type).toBe("prompt");
    const payload = JSON.parse(sent.message.slice("/spopi-config ".length));
    expect(payload.op).toBe("start_oauth_login");
    expect(payload.params).toEqual({ provider: "openai-codex", method: "device_code" });
    expect(payload.id.startsWith("oa-")).toBe(true);

    gateway.consumeFrame(
      responseEnvelope(payload.id, {
        ok: true,
        data: { operationId: "op-1", provider: "openai-codex", state: "starting" },
      }),
    );
    await expect(promise).resolves.toEqual({
      success: true,
      data: { operationId: "op-1", provider: "openai-codex", state: "starting" },
    });
  });

  it("resolves an error response frame as { success: false, error }", async () => {
    const { gateway } = createHarness();
    const promise = gateway.command({ type: "oauth_logout", provider: "openai-codex" });
    gateway.consumeFrame(responseEnvelope("oa-1", { ok: false, error: "no credential" }));
    await expect(promise).resolves.toEqual({ success: false, error: "no credential" });
  });

  // Real bridge order (spopi-bridge.ts): the start command responds with
  // { state: "starting" } immediately, then device_code/progress/terminal
  // events stream as __spopiOauth frames keyed to the SAME request id.
  it("streams post-response events to the subscriber in the real bridge order", async () => {
    const { gateway } = createHarness();
    const seen = [];
    gateway.subscribe(({ event }) => seen.push(event));

    const promise = gateway.command({
      type: "start_oauth_login",
      provider: "openai-codex",
      method: "device_code",
    });
    const configId = "oa-1";

    gateway.consumeFrame(
      responseEnvelope(configId, {
        ok: true,
        data: { operationId: "op-1", provider: "openai-codex", state: "starting" },
      }),
    );
    await expect(promise).resolves.toEqual({
      success: true,
      data: { operationId: "op-1", provider: "openai-codex", state: "starting" },
    });

    expect(
      gateway.consumeFrame(eventEnvelope(configId, { type: "device_code", userCode: "A1" })),
    ).toBe(true);
    expect(
      gateway.consumeFrame(eventEnvelope(configId, { type: "progress", message: "polling" })),
    ).toBe(true);
    expect(seen.map((event) => event.type)).toEqual(["device_code", "progress"]);

    gateway.consumeFrame(eventEnvelope(configId, { type: "complete" }));
    expect(seen.map((event) => event.type)).toEqual(["device_code", "progress", "complete"]);
    expect(gateway.size()).toBe(0);
  });

  // The bridge emits the terminal cancelled event (keyed to the cancel
  // request id) BEFORE its own response frame settles; the gateway must
  // settle the pending request from the event and swallow the late response.
  it("settles a pending request from a terminal event arriving before its response", async () => {
    const { gateway } = createHarness();
    const seen = [];
    gateway.subscribe(({ event }) => seen.push(event));

    const promise = gateway.command({ type: "cancel_oauth_login", operationId: "op-1" });
    gateway.consumeFrame(eventEnvelope("oa-1", { type: "cancelled" }));
    expect(seen.map((event) => event.type)).toEqual(["cancelled"]);
    await expect(promise).resolves.toEqual({ success: true, data: { state: "cancelled" } });

    // The response frame for the already-settled id is ours but stale — it
    // must be consumed (not leaked to other consumers) without throwing.
    expect(gateway.consumeFrame(responseEnvelope("oa-1", { ok: true, data: {} }))).toBe(true);
    expect(gateway.size()).toBe(0);
  });

  it("swallows event envelopes when no subscription is active", () => {
    const { gateway } = createHarness();
    expect(gateway.consumeFrame(eventEnvelope("oa-unknown", { type: "device_code" }))).toBe(true);
    expect(gateway.consumeFrame(responseEnvelope("oa-unknown", { ok: true, data: {} }))).toBe(true);
    expect(gateway.consumeFrame({ type: "runtime_event", event: {} })).toBe(false);
    expect(gateway.consumeFrame({ type: "runtime_event" })).toBe(false);
  });

  it("dispatches event envelopes for unknown ids while a subscription is active", () => {
    const { gateway } = createHarness();
    const seen = [];
    gateway.subscribe(({ event }) => seen.push(event));
    // Session-level gate: a subscribed window consumes events regardless of
    // the pending map (events outlive the start response); unsubscribed
    // windows drop them (previous test).
    expect(gateway.consumeFrame(eventEnvelope("oa-unknown", { type: "device_code" }))).toBe(true);
    expect(seen.map((event) => event.type)).toEqual(["device_code"]);
  });

  it("ignores frames without the __spopiOauth marker or oa- response prefix", () => {
    const { gateway } = createHarness();
    const frame = {
      type: "runtime_event",
      event: { type: "extension_ui_request", message: '{"__spopiConfig":"x"}' },
    };
    expect(gateway.consumeFrame(frame)).toBe(false);
  });

  it("times out a pending request when no terminal event arrives", async () => {
    vi.useFakeTimers();
    try {
      const { gateway } = createHarness();
      const promise = gateway.command({ type: "get_oauth_login_status" }, { timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects immediately when there is no active session target", async () => {
    const runtime = { request: vi.fn() };
    const gateway = createOauthGateway({ runtime, getTarget: () => null });
    await expect(gateway.command({ type: "oauth_logout" })).rejects.toThrow("No active session");
  });
});
