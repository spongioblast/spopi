// ABOUTME: Unit tests for the Codex device-code login dialog state machine.
// ABOUTME: Covers event rendering, terminal transitions, retry, and cancel.

import { describe, expect, it, vi } from "vitest";
import { createModelsOAuthLoginDialog } from "./models-oauth-login.js";

const t = (key) => key;

function createHarness({ command } = {}) {
  document.body.replaceChildren();
  const handlers = [];
  const unsubscribes = [];
  const commandMock =
    command ?? vi.fn(() => Promise.resolve({ success: true, data: { operationId: "op-1" } }));
  const dialog = createModelsOAuthLoginDialog({
    command: commandMock,
    subscribe: (handler) => {
      handlers.push(handler);
      unsubscribes.push(() => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      });
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    openExternal: vi.fn(),
    copyText: vi.fn(),
    onSuccess: vi.fn(),
    onTerminal: vi.fn(),
    t,
  });
  return {
    dialog,
    commandMock,
    handlers,
    emit: (event) => {
      for (const handler of handlers) handler({ event });
    },
  };
}

describe("createModelsOAuthLoginDialog", () => {
  it("renders the device code with actions after start", async () => {
    const { dialog, emit } = createHarness();
    void dialog.start();
    await Promise.resolve();

    emit({
      type: "device_code",
      verificationUri: "https://example.com/activate",
      userCode: "ABCD-1234",
      expiresInSeconds: 60,
    });

    expect(document.querySelector(".oauth-login-dialog-code").textContent).toBe("ABCD-1234");
    expect(document.querySelector(".oauth-login-dialog-url").textContent).toBe(
      "https://example.com/activate",
    );
    expect(document.querySelector('[data-action="oauth-open-browser"]')).not.toBeNull();
    expect(document.querySelector('[data-action="oauth-copy-code"]')).not.toBeNull();
    expect(document.querySelector(".oauth-login-dialog-countdown").textContent).toBe("60s");
  });

  it("transitions to the connected state on complete and notifies the caller", async () => {
    const { dialog, emit } = createHarness();
    void dialog.start();
    await Promise.resolve();

    emit({ type: "complete" });
    expect(document.querySelector(".oauth-login-dialog-title").textContent).toBe(
      "settings.models.oauth.connected",
    );
    // Terminal: no countdown timer may survive.
    expect(document.querySelector(".oauth-login-dialog-countdown")).toBeNull();
  });

  it("shows sanitized failure messages and supports retry", async () => {
    const commandMock = vi.fn(() => Promise.resolve({ success: false, error: "denied" }));
    const { dialog, commandMock: cmd } = createHarness({ command: commandMock });
    void dialog.start();
    await Promise.resolve();

    expect(cmd).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".oauth-login-dialog-title").textContent).toBe(
      "settings.models.oauth.failed",
    );
    expect(document.querySelector('[data-action="oauth-retry"]')).not.toBeNull();
  });

  it("rewrites self-signed TLS failures into a proxy CA hint", async () => {
    const { dialog, emit } = createHarness();
    void dialog.start();
    await Promise.resolve();
    emit({
      type: "failed",
      message: "Error: self signed certificate in certificate chain",
    });
    expect(document.querySelector(".oauth-login-dialog-status").textContent).toBe(
      "settings.models.oauth.tlsUntrusted",
    );
  });

  it("shows preparing immediately while the start command is pending", async () => {
    let resolveCommand;
    const commandMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const { dialog } = createHarness({ command: commandMock });
    void dialog.start();
    await Promise.resolve();

    expect(document.querySelector(".oauth-login-dialog-title").textContent).toBe(
      "settings.models.oauth.preparing",
    );
    expect(document.querySelector('[data-action="oauth-cancel"]')).not.toBeNull();

    resolveCommand({ success: true, data: { operationId: "op-1" } });
    await Promise.resolve();
    expect(document.querySelector(".oauth-login-dialog-title").textContent).toBe(
      "settings.models.oauth.preparing",
    );
  });

  it("accepts a device_code event that arrives before start resolves", async () => {
    let resolveCommand;
    const commandMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const { dialog, emit } = createHarness({ command: commandMock });
    void dialog.start();
    await Promise.resolve();

    emit({
      type: "device_code",
      verificationUri: "https://example.com/activate",
      userCode: "EARLY-1",
    });
    expect(document.querySelector(".oauth-login-dialog-code").textContent).toBe("EARLY-1");

    resolveCommand({ success: true, data: { operationId: "op-1" } });
  });

  it("sends cancel for the active operation", async () => {
    const commandMock = vi.fn((frame) => {
      if (frame.type === "cancel_oauth_login") {
        return Promise.resolve({ success: true, data: { operationId: frame.operationId } });
      }
      return Promise.resolve({ success: true, data: { operationId: "op-1" } });
    });
    const { dialog, commandMock: cmd, emit } = createHarness({ command: commandMock });
    void dialog.start();
    await Promise.resolve();
    emit({
      type: "device_code",
      verificationUri: "https://example.com/activate",
      userCode: "A1",
    });

    document.querySelector('[data-action="oauth-cancel"]').click();

    const cancelFrame = cmd.mock.calls.find(([frame]) => frame.type === "cancel_oauth_login");
    expect(cancelFrame[0].operationId).toBe("op-1");
  });

  it("cancels on Escape while the device-code dialog is open", async () => {
    const commandMock = vi.fn((frame) => {
      if (frame.type === "cancel_oauth_login") {
        return Promise.resolve({ success: true, data: { operationId: frame.operationId } });
      }
      return Promise.resolve({ success: true, data: { operationId: "op-1" } });
    });
    const { dialog, commandMock: cmd, emit } = createHarness({ command: commandMock });
    void dialog.start();
    await Promise.resolve();
    emit({
      type: "device_code",
      verificationUri: "https://example.com/activate",
      userCode: "A1",
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    const cancelFrame = cmd.mock.calls.find(([frame]) => frame.type === "cancel_oauth_login");
    expect(cancelFrame[0].operationId).toBe("op-1");
  });
});
