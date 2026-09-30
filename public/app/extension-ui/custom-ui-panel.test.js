// ABOUTME: Tests CustomUiPanel.
// ABOUTME: Includes "ignores notifications that are not custom-UI frames".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomUiPanel } from "./custom-ui-panel.js";

const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };
const ESC = String.fromCharCode(27);

// Stands in for xterm.js: records what SPOPI wrote and lets tests fire input
// the way a real terminal would, without depending on xterm's renderer.
class FakeTerminal {
  static instances = [];
  constructor(options) {
    this.options = options;
    this.cols = options.cols;
    this.rows = options.rows;
    this.writes = [];
    this.disposed = false;
    this.focused = false;
    this.onDataHandler = null;
    FakeTerminal.instances.push(this);
  }
  open() {}
  write(data) {
    this.writes.push(data);
  }
  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
  }
  focus() {
    this.focused = true;
  }
  onData(handler) {
    this.onDataHandler = handler;
    return {
      dispose: () => {
        this.onDataHandler = null;
      },
    };
  }
  dispose() {
    this.disposed = true;
  }
}

const notify = (payload) => ({
  type: "extension_ui_request",
  method: "notify",
  message: JSON.stringify({ __spopiCustomUi: payload }),
});

function setup({ onError = () => {}, enabled = true } = {}) {
  const runtime = { request: vi.fn().mockResolvedValue({}) };
  const panel = new CustomUiPanel({ runtime, getTarget: () => target, onError, enabled });
  return { runtime, panel };
}

// The command the panel sends is `/spopi-custom-ui <json>`; tests assert on the
// decoded payload rather than exact string formatting.
const sentPayloads = (runtime) =>
  runtime.request.mock.calls.map(([command]) =>
    JSON.parse(command.message.replace("/spopi-custom-ui ", "")),
  );

describe("CustomUiPanel", () => {
  beforeEach(() => {
    FakeTerminal.instances = [];
    document.body.innerHTML = "";
    globalThis.SpopiXterm = { Terminal: FakeTerminal };
  });

  afterEach(() => {
    delete globalThis.SpopiXterm;
  });

  it("ignores notifications that are not custom-UI frames", () => {
    const { panel } = setup();
    expect(panel.consumeNotify({ message: "just a normal message" })).toBe(false);
    expect(panel.isOpen).toBe(false);
  });

  it("swallows custom-UI frames without opening while the overlay is disabled", () => {
    const { panel } = setup({ enabled: false });
    const consumed = panel.consumeNotify(
      notify({ op: "open", id: "panel-1", width: 60, lines: ["╭── MCP ──╮"] }),
    );

    expect(consumed).toBe(true);
    expect(panel.isOpen).toBe(false);
    expect(document.querySelectorAll(".custom-ui-overlay")).toHaveLength(0);
    expect(FakeTerminal.instances).toHaveLength(0);
  });

  it("opens an overlay sized to the component and paints its lines", () => {
    const { panel } = setup();
    const consumed = panel.consumeNotify(
      notify({ op: "open", id: "panel-1", width: 60, lines: ["╭── MCP ──╮", "│ hi     │"] }),
    );

    expect(consumed).toBe(true);
    expect(panel.isOpen).toBe(true);
    expect(document.querySelectorAll(".custom-ui-overlay")).toHaveLength(1);
    const terminal = FakeTerminal.instances[0];
    expect(terminal.cols).toBe(60);
    expect(terminal.focused).toBe(true);
    expect(terminal.writes.at(-1)).toContain("╭── MCP ──╮");
    expect(terminal.writes.at(-1)).toContain(`${ESC}[2J`);
  });

  it("forwards keystrokes to the extension tagged with the panel id", () => {
    const { runtime, panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["x"] }));
    FakeTerminal.instances[0].onDataHandler(`${ESC}[B`);

    expect(sentPayloads(runtime)).toEqual([{ id: "panel-1", data: `${ESC}[B` }]);
  });

  it("repaints and resizes when the component re-renders", () => {
    const { panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["one"] }));
    panel.consumeNotify(
      notify({ op: "update", id: "panel-1", lines: ["one", "two", "three", "four"] }),
    );

    const terminal = FakeTerminal.instances[0];
    expect(terminal.rows).toBe(4);
    expect(terminal.writes.at(-1)).toContain("four");
  });

  it("drops updates addressed to a panel that is no longer open", () => {
    const { panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["one"] }));
    const terminal = FakeTerminal.instances[0];
    const writeCount = terminal.writes.length;

    expect(panel.consumeNotify(notify({ op: "update", id: "panel-stale", lines: ["nope"] }))).toBe(
      true,
    );
    expect(terminal.writes).toHaveLength(writeCount);
  });

  it("tears down the overlay when the extension closes the panel", () => {
    const { runtime, panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["x"] }));
    panel.consumeNotify(notify({ op: "close", id: "panel-1" }));

    expect(panel.isOpen).toBe(false);
    expect(document.querySelectorAll(".custom-ui-overlay")).toHaveLength(0);
    expect(FakeTerminal.instances[0].disposed).toBe(true);
    // A close driven by the extension must not echo a cancel back to it.
    expect(runtime.request).not.toHaveBeenCalled();
  });

  it("close() asks the extension to cancel so the blocked caller resolves", () => {
    const { runtime, panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["x"] }));
    panel.close();

    expect(panel.isOpen).toBe(false);
    expect(sentPayloads(runtime)).toEqual([{ id: "panel-1", cancel: true }]);
  });

  it("close({ notifyExtension: false }) tears down silently", () => {
    const { runtime, panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["x"] }));
    panel.close({ notifyExtension: false });

    expect(panel.isOpen).toBe(false);
    expect(runtime.request).not.toHaveBeenCalled();
  });

  it("reports panel errors and closes", () => {
    const onError = vi.fn();
    const { panel } = setup({ onError });
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["x"] }));
    panel.consumeNotify(notify({ op: "error", id: "panel-1", message: "component exploded" }));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "component exploded" }),
    );
    expect(panel.isOpen).toBe(false);
  });

  it("replaces the visible panel when a nested overlay opens", () => {
    const { panel } = setup();
    panel.consumeNotify(notify({ op: "open", id: "panel-1", width: 40, lines: ["first"] }));
    panel.consumeNotify(notify({ op: "open", id: "panel-2", width: 40, lines: ["second"] }));

    expect(document.querySelectorAll(".custom-ui-overlay")).toHaveLength(1);
    expect(FakeTerminal.instances[0].disposed).toBe(true);
    expect(FakeTerminal.instances[1].writes.at(-1)).toContain("second");
  });
});
