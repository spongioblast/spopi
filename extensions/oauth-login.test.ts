// ABOUTME: Unit tests for the in-memory OAuth operation manager and adapter projection.
// ABOUTME: Covers lifecycle, sanitization, unknown-id semantics, and seam-missing detection.

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createPiOAuthLoginAdapter } from "./bridge/pi-oauth-login-adapter";
import { createOAuthLoginOperationManager } from "./oauth-login-operations";

describe("createOAuthLoginOperationManager", () => {
  it("runs the full lifecycle: start → device_code → progress → complete", () => {
    const manager = createOAuthLoginOperationManager({ createId: () => "op-1" });
    const started = manager.start();
    expect(started.operationId).toBe("op-1");
    expect(manager.getStatus("op-1").state).toBe("starting");

    const code = manager.bindDeviceCode("op-1", {
      verificationUri: "https://example.com/activate",
      userCode: "ABCD-1234",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    });
    expect(code).toEqual({
      type: "device_code",
      verificationUri: "https://example.com/activate",
      userCode: "ABCD-1234",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    });

    expect(manager.bindProgress("op-1", "waiting for authorization")).toEqual({
      type: "progress",
      message: "waiting for authorization",
    });
    expect(manager.complete("op-1")).toEqual({ type: "complete" });
    // Terminal: the map is empty again, so status falls back to expired (M2).
    expect(manager.getStatus("op-1").state).toBe("expired");
  });

  it("rejects a second start while one is active", () => {
    const manager = createOAuthLoginOperationManager();
    manager.start();
    expect(() => manager.start()).toThrow("OAuth login already in progress");
  });

  it("sanitizes token-like material out of failure messages", () => {
    const manager = createOAuthLoginOperationManager();
    const { operationId } = manager.start();
    const event = manager.fail(
      operationId,
      "request failed: Authorization: Bearer sk-secret123&next=/x?access_token=abc",
    );
    expect(event.type).toBe("failed");
    if (event.type === "failed") {
      expect(event.message).not.toContain("sk-secret123");
      expect(event.message).not.toContain("access_token=abc");
      expect(event.message).toContain("[redacted]");
    }
  });

  it("cancels via abort signal and tolerates unknown ids as no-op (M2)", () => {
    const manager = createOAuthLoginOperationManager();
    const started = manager.start();
    let aborted = false;
    started.signal.addEventListener("abort", () => {
      aborted = true;
    });

    expect(manager.cancel("unknown-id")).toBeNull();
    const event = manager.cancel(started.operationId);
    expect(event?.type).toBe("cancelled");
    expect(aborted).toBe(true);
    expect(() => manager.cancel(started.operationId)).not.toThrow();
  });

  it("expires an active operation on demand", () => {
    const manager = createOAuthLoginOperationManager();
    const { operationId } = manager.start();
    expect(manager.expire(operationId)).toEqual({ type: "expired" });
  });
});

describe("createPiOAuthLoginAdapter", () => {
  it("reports unsupported when ModelRuntime.login is missing", async () => {
    const adapter = createPiOAuthLoginAdapter({} as never);
    const capability = await adapter.getCodexCapability();
    expect(capability.kind).toBe("unsupported");
  });

  it("reports provider-unavailable when checkAuth rejects", async () => {
    const adapter = createPiOAuthLoginAdapter({
      login: vi.fn(),
      checkAuth: vi.fn().mockRejectedValue(new Error("no such provider")),
      logout: vi.fn(),
    } as never);
    const capability = await adapter.getCodexCapability();
    expect(capability).toMatchObject({ kind: "provider-unavailable" });
  });

  it("projects device_code and progress events, then resolves on login success", async () => {
    let notify: ((event: never) => void) | null = null;
    const runtime = {
      login: vi.fn((_provider: string, _type: string, interaction: never) => {
        notify = (interaction as { notify: (event: never) => void }).notify;
        return new Promise(() => undefined); // stays pending until abort
      }),
      checkAuth: vi.fn().mockResolvedValue({ configured: false }),
      logout: vi.fn(),
    };
    const adapter = createPiOAuthLoginAdapter(runtime as never);
    const events: Array<Record<string, unknown>> = [];
    const controller = new AbortController();

    void adapter
      .startCodexDeviceCodeLogin(
        {
          onDeviceCode: (code) => events.push({ kind: "code", ...code }),
          onProgress: (message) => events.push({ kind: "progress", message }),
        },
        controller.signal,
      )
      .catch(() => undefined);

    await vi.waitFor(() => expect(notify).not.toBeNull());
    (notify as unknown as (event: Record<string, unknown>) => void)({
      type: "device_code",
      userCode: "XYZ-999",
      verificationUri: "https://example.com/activate",
      expiresInSeconds: 300,
    });
    (notify as unknown as (event: Record<string, unknown>) => void)({
      type: "progress",
      message: "polling",
    });

    expect(events).toEqual([
      {
        kind: "code",
        userCode: "XYZ-999",
        verificationUri: "https://example.com/activate",
        expiresInSeconds: 300,
      },
      { kind: "progress", message: "polling" },
    ]);
    controller.abort();
  });
});
