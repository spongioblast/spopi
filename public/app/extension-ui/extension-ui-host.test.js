// ABOUTME: Tests ExtensionUiHost.
// ABOUTME: Includes "queues blocking dialogs by session and responds only with the bound target".
import { describe, expect, it, vi } from "vitest";
import { ExtensionUiHost } from "./extension-ui-host.js";

const targetA = { workspaceId: "w", sessionId: "a", instanceId: "ia" };
const targetB = { workspaceId: "w", sessionId: "b", instanceId: "ib" };

describe("ExtensionUiHost", () => {
  it("closes an open prompt when the host already resolved it", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    /** @type {() => void} */
    let opened = () => {};
    const shown = new Promise((resolve) => {
      opened = resolve;
    });
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: (_request, { dismissSignal }) => {
        opened();
        return dismissSignal.then(() => ({ cancelled: true }));
      },
    });
    host.setForegroundSession("a");
    const pending = host.handle(targetA, {
      type: "extension_ui_request",
      id: "perm-1",
      method: "select",
      title: "tool    : bash",
      options: ["Yes", "No"],
    });
    await shown;
    host.resolveFromHost("perm-1");
    await pending;
    expect(runtime.request).not.toHaveBeenCalled();
  });

  it("queues blocking dialogs by session and responds only with the bound target", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({ acceptance: "completed" }) };
    const shown = [];
    const host = new ExtensionUiHost({
      runtime,
      showDialog: async (request) => {
        shown.push(request);
        return request.method === "confirm" ? { confirmed: true } : { value: "chosen" };
      },
    });
    host.setForegroundSession("a");
    await host.handle(targetB, {
      type: "extension_ui_request",
      id: "dialog-b",
      method: "select",
      title: "Background",
      options: ["chosen"],
    });
    expect(shown).toHaveLength(0);
    expect(host.pendingCount("b")).toBe(1);

    await host.handle(targetA, {
      type: "extension_ui_request",
      id: "dialog-a",
      method: "confirm",
      title: "Foreground",
      message: "Continue?",
    });
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "dialog-a", confirmed: true },
      targetA,
    );
    await host.setForegroundSession("b");
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "dialog-b", value: "chosen" },
      targetB,
    );
  });

  it("routes non-blocking UI without logging response values", async () => {
    const hooks = {
      notify: vi.fn(),
      status: vi.fn(),
      widget: vi.fn(),
      title: vi.fn(),
      editorText: vi.fn(),
    };
    const host = new ExtensionUiHost({ runtime: { request: vi.fn() }, hooks });
    for (const request of [
      { method: "notify", message: "hello", notifyType: "info" },
      { method: "setStatus", statusKey: "build", statusText: "running" },
      { method: "setWidget", widgetKey: "branch", content: "main" },
      { method: "setTitle", title: "Project" },
      { method: "set_editor_text", text: "prefill" },
    ]) {
      await host.handle(targetA, { type: "extension_ui_request", id: request.method, ...request });
    }
    expect(hooks.notify).toHaveBeenCalled();
    expect(hooks.status).toHaveBeenCalled();
    expect(hooks.widget).toHaveBeenCalled();
    expect(hooks.title).toHaveBeenCalled();
    expect(hooks.editorText).toHaveBeenCalled();
  });

  it("reports TUI-only operations as unsupported", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const host = new ExtensionUiHost({ runtime, showDialog: vi.fn() });
    await host.handle(targetA, {
      type: "extension_ui_request",
      id: "custom-1",
      method: "custom",
    });
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "custom-1", cancelled: true, error: "unsupported" },
      targetA,
    );
  });

  it("cancelForeground() finalizes the shown dialog as cancelled instead of re-queuing it", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: (_request, { dismissSignal }) =>
        new Promise((resolve) => {
          dismissSignal.then(() => resolve({ cancelled: true }));
        }),
    });
    host.setForegroundSession("a");

    const handled = host.handle(targetA, {
      type: "extension_ui_request",
      id: "dialog-a",
      method: "select",
      title: "Pick one",
      options: ["chosen"],
    });
    expect(host.hasPending("a")).toBe(true);

    host.cancelForeground();
    await handled;

    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "dialog-a", cancelled: true },
      targetA,
    );
    expect(host.pendingCount("a")).toBe(0);
    expect(host.hasPending("a")).toBe(false);
  });

  it("cancelForegroundWhere() leaves a dialog the test rejects alone", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: (_request, { dismissSignal }) =>
        new Promise((resolve) => {
          dismissSignal.then(() => resolve({ cancelled: true }));
        }),
    });
    host.setForegroundSession("a");
    const handled = host.handle(targetA, {
      type: "extension_ui_request",
      id: "input-a",
      method: "input",
      title: 'Waiting for sign-in to "remote".',
    });
    host.cancelForegroundWhere((request) => request.method === "select");
    expect(host.hasPending("a")).toBe(true);
    host.cancelForegroundWhere((request) => String(request.title).includes('"remote"'));
    await handled;
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "input-a", cancelled: true },
      targetA,
    );
  });

  it("switching sessions away re-queues the in-flight dialog instead of finalizing it", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: (_request, { dismissSignal }) =>
        new Promise((resolve) => {
          dismissSignal.then(() => resolve({ cancelled: true }));
        }),
    });
    host.setForegroundSession("a");

    const handled = host.handle(targetA, {
      type: "extension_ui_request",
      id: "dialog-a",
      method: "select",
      title: "Pick one",
      options: ["chosen"],
    });

    await host.setForegroundSession("b", { flush: false });
    await handled;

    expect(runtime.request).not.toHaveBeenCalled();
    expect(host.pendingCount("a")).toBe(1);
    expect(host.hasPending("a")).toBe(true);
  });

  it("shows an in-flight dialog again when switching away and immediately back", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    let shown = 0;
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: (_request, { dismissSignal }) => {
        shown += 1;
        if (shown > 1) return Promise.resolve({ value: "chosen" });
        return new Promise((resolve) => {
          dismissSignal.then(() => {
            setTimeout(() => resolve({ cancelled: true }), 0);
          });
        });
      },
    });
    await host.setForegroundSession("a");

    const handled = host.handle(targetA, {
      type: "extension_ui_request",
      id: "dialog-a",
      method: "select",
      title: "Pick one",
      options: ["chosen"],
    });

    await host.setForegroundSession("b");
    await host.setForegroundSession("a");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown).toBe(2);
    await handled;
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "dialog-a", value: "chosen" },
      targetA,
    );
  });

  it("shows a replayed dialog once while the same id is open or queued", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    let shown = 0;
    /** @type {(value: { value: string }) => void} */
    let answer = () => {};
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: () => {
        shown += 1;
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });
    const request = {
      type: "extension_ui_request",
      id: "ask-1",
      method: "select",
      title: "Reload",
      options: ["Reloaded"],
    };
    host.setForegroundSession("a");
    const first = host.handle(targetA, request);
    await host.handle(targetA, { ...request });
    expect(shown).toBe(1);

    await host.handle(targetB, { ...request });
    await host.handle(targetB, { ...request });
    expect(host.pendingCount("b")).toBe(1);

    answer({ value: "Reloaded" });
    await first;
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "ask-1", value: "Reloaded" },
      targetA,
    );
  });

  it("uses inline prompts before falling back to modal dialogs", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const showDialog = vi.fn();
    const host = new ExtensionUiHost({
      runtime,
      showDialog,
      showInlinePrompt: () => Promise.resolve({ value: "1. A — Alpha" }),
    });
    host.setForegroundSession("a");

    await host.handle(targetA, {
      type: "extension_ui_request",
      id: "inline-1",
      method: "select",
      title: "[Choice] Pick one",
      options: ["1. A — Alpha"],
    });

    expect(showDialog).not.toHaveBeenCalled();
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "inline-1", value: "1. A — Alpha" },
      targetA,
    );
  });

  it("re-queues an in-flight prompt so history re-renders can recreate the clickable UI", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    let shown = 0;
    const host = new ExtensionUiHost({
      runtime,
      showInlinePrompt: (_request, { dismissSignal }) => {
        shown += 1;
        if (shown === 1) {
          return new Promise((resolve) => {
            dismissSignal.then(() => resolve({ cancelled: true }));
          });
        }
        return Promise.resolve({ value: "1. A — Alpha" });
      },
    });
    host.setForegroundSession("a");

    const handled = host.handle(targetA, {
      type: "extension_ui_request",
      id: "inline-1",
      method: "select",
      title: "[Choice] Pick one",
      options: ["1. A — Alpha"],
    });
    expect(shown).toBe(1);

    expect(host.requeueForegroundPrompt()).toBe(true);

    expect(runtime.request).not.toHaveBeenCalled();

    await host.flushForegroundQueue();
    await handled;

    expect(shown).toBe(2);
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "extension_ui_response", id: "inline-1", value: "1. A — Alpha" },
      targetA,
    );
  });
});
