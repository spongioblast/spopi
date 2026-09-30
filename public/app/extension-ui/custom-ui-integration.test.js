// ABOUTME: Tests custom UI end to end.
// ABOUTME: Includes "renders a panel emitted by the bridge and keeps it out of the transcript".
// Wires the real ExtensionUiHost to the real CustomUiPanel using the exact
// frame shape the spopi-bridge extension emits, so a mismatch anywhere along
// runtime event -> host -> notify hook -> panel fails here rather than only in
// the running app.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomUiPanel } from "./custom-ui-panel.js";
import { ExtensionUiHost } from "./extension-ui-host.js";

const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };

class FakeTerminal {
  static instances = [];
  constructor(options) {
    this.options = options;
    this.cols = options.cols;
    this.rows = options.rows;
    this.writes = [];
    FakeTerminal.instances.push(this);
  }
  open() {}
  write(data) {
    this.writes.push(data);
  }
  resize() {}
  focus() {}
  onData() {
    return { dispose: () => {} };
  }
  dispose() {}
}

// Exactly what pi's rpc-mode emits for `ctx.ui.notify(JSON.stringify(...))`:
// the bridge payload arrives wrapped in a `notify` extension-UI request.
const bridgeNotifyFrame = (payload) => ({
  type: "extension_ui_request",
  id: "b6b1f0e2-0000-4000-8000-000000000000",
  method: "notify",
  message: JSON.stringify({ __spopiCustomUi: payload }),
  notifyType: "info",
});

describe("custom UI end to end", () => {
  beforeEach(() => {
    FakeTerminal.instances = [];
    document.body.innerHTML = "";
    globalThis.SpopiXterm = { Terminal: FakeTerminal };
  });

  it("renders a panel emitted by the bridge and keeps it out of the transcript", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const panel = new CustomUiPanel({ runtime, getTarget: () => target, enabled: true });
    const renderSystemMessage = vi.fn();

    const host = new ExtensionUiHost({
      runtime,
      hooks: {
        // Mirrors the ordering in app.js.
        notify: (request) => {
          if (panel.consumeNotify(request)) return;
          renderSystemMessage(request.message || "");
        },
      },
    });
    await host.setForegroundSession(target.sessionId);

    await host.handle(
      target,
      bridgeNotifyFrame({ op: "open", id: "panel-1", width: 82, lines: ["╭── MCP ──╮"] }),
    );

    expect(panel.isOpen).toBe(true);
    expect(document.querySelectorAll(".custom-ui-overlay")).toHaveLength(1);
    expect(renderSystemMessage).not.toHaveBeenCalled();
    expect(FakeTerminal.instances[0].writes.at(-1)).toContain("╭── MCP ──╮");
  });

  it("swallows the frame without opening an overlay when the renderer is off", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const panel = new CustomUiPanel({ runtime, getTarget: () => target, enabled: false });
    const renderSystemMessage = vi.fn();

    const host = new ExtensionUiHost({
      runtime,
      hooks: {
        notify: (request) => {
          if (panel.consumeNotify(request)) return;
          renderSystemMessage(request.message || "");
        },
      },
    });
    await host.setForegroundSession(target.sessionId);

    await host.handle(
      target,
      bridgeNotifyFrame({ op: "open", id: "panel-1", width: 82, lines: ["╭── MCP ──╮"] }),
    );

    expect(panel.isOpen).toBe(false);
    expect(document.querySelectorAll(".custom-ui-overlay")).toHaveLength(0);
    expect(renderSystemMessage).not.toHaveBeenCalled();
  });

  it("still renders ordinary notifications as system messages", async () => {
    const runtime = { request: vi.fn().mockResolvedValue({}) };
    const panel = new CustomUiPanel({ runtime, getTarget: () => target });
    const renderSystemMessage = vi.fn();

    const host = new ExtensionUiHost({
      runtime,
      hooks: {
        notify: (request) => {
          if (panel.consumeNotify(request)) return;
          renderSystemMessage(request.message || "");
        },
      },
    });
    await host.setForegroundSession(target.sessionId);

    await host.handle(target, {
      type: "extension_ui_request",
      id: "n1",
      method: "notify",
      message: "MCP: 3 servers enabled",
    });

    expect(panel.isOpen).toBe(false);
    expect(renderSystemMessage).toHaveBeenCalledWith("MCP: 3 servers enabled");
  });
});
