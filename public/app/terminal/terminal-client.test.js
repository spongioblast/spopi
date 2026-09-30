// ABOUTME: Tests for the terminal client replay state machine: checkpoint before
// ABOUTME: strictly sequential journal, forward-gap pause, and envelope shape.
import { describe, expect, test, vi } from "vitest";
import { TerminalClient } from "./terminal-client.js";

function fakeTab() {
  const calls = [];
  return {
    calls,
    writeSnapshot: () => calls.push("write:snapshot"),
    writeOutput: (data) => calls.push(`write:${data}`),
    ack: (seq) => calls.push(`ack:${seq}`),
    destroy: () => calls.push("destroy"),
  };
}

function snapshot({ watermark = 0, journal = [], checkpoint = "snap" } = {}) {
  return {
    terminalId: "t1",
    generation: 1,
    checkpoint,
    checkpointWatermark: watermark,
    journal,
  };
}

function batch(seq, data) {
  return { firstSequence: seq, lastSequence: seq, dataBase64: data };
}

function outputBatch(seq, data) {
  return {
    terminalId: "t1",
    generation: 1,
    firstSequence: seq,
    lastSequence: seq,
    dataBase64: data,
  };
}

describe("TerminalClient replay", () => {
  test("replays checkpoint before strictly sequential journal output", () => {
    const tab = fakeTab();
    const client = new TerminalClient({ send: vi.fn(), createTab: () => tab });
    client.applySnapshot(snapshot({ watermark: 2, journal: [batch(3, "three")] }));
    expect(tab.calls).toEqual(["write:snapshot", "write:three", "ack:3"]);
  });

  test("forward sequence gap pauses output and requests a fresh list", () => {
    const send = vi.fn();
    const tab = fakeTab();
    const client = new TerminalClient({ send, createTab: () => tab });
    client.setWorkspaceGeneration(0);
    client.applySnapshot(snapshot({ watermark: 2, journal: [] }));
    tab.calls.length = 0;
    send.mockClear();

    client.applyOutput(outputBatch(4, "late"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { type: "terminal_list" } }),
    );

    // Further output stays paused until a fresh snapshot arrives.
    client.applyOutput(outputBatch(5, "more"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(tab.calls).toEqual([]);
  });

  test("duplicate sequence is ignored without advancing", () => {
    const tab = fakeTab();
    const client = new TerminalClient({ send: vi.fn(), createTab: () => tab });
    client.applySnapshot(snapshot({ watermark: 2, journal: [] }));
    tab.calls.length = 0;
    client.applyOutput(outputBatch(3, "three"));
    expect(tab.calls).toEqual(["write:three", "ack:3"]);
    // Replay of the same sequence must not duplicate or advance.
    client.applyOutput(outputBatch(3, "three"));
    expect(tab.calls).toEqual(["write:three", "ack:3"]);
  });

  test("commands wait until the workspace generation is known", () => {
    const send = vi.fn();
    const client = new TerminalClient({ send, createTab: fakeTab });
    expect(client.command({ type: "terminal_list" })).toBeNull();
    expect(send).not.toHaveBeenCalled();
    client.setWorkspaceGeneration(0);
    client.command({ type: "terminal_list" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("rejects an invalid workspace generation without replacing the current token", () => {
    const send = vi.fn();
    const client = new TerminalClient({ send, createTab: fakeTab });
    expect(client.setWorkspaceGeneration(7)).toBe(true);
    expect(client.setWorkspaceGeneration(-1)).toBe(false);
    client.command({ type: "terminal_list" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ workspaceGeneration: 7 }));
  });

  test("command wraps payload in a terminal_command envelope with generation", () => {
    const send = vi.fn();
    const client = new TerminalClient({ send, createTab: fakeTab });
    client.setWorkspaceGeneration(42);
    client.command({ type: "terminal_input", terminalId: "t1", generation: 1, dataBase64: "" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "terminal_command",
        workspaceGeneration: 42,
        payload: { type: "terminal_input", terminalId: "t1", generation: 1, dataBase64: "" },
      }),
    );
  });

  test("applyListed rebuilds tabs from descriptors", () => {
    const send = vi.fn();
    const client = new TerminalClient({ send, createTab: fakeTab });
    client.applyListed({
      tabs: [
        {
          terminalId: "a",
          generation: 1,
          checkpoint: "cA",
          checkpointWatermark: 5,
          historyGap: false,
        },
      ],
    });
    expect(client.tabs.size).toBe(1);
    expect(client.tabs.get("a").lastAppliedSequence).toBe(5);
  });

  test("reset destroys all tabs", () => {
    const tab = fakeTab();
    const client = new TerminalClient({ send: vi.fn(), createTab: () => tab });
    client.applySnapshot(snapshot());
    client.reset();
    expect(client.tabs.size).toBe(0);
    expect(tab.calls).toContain("destroy");
  });

  test("history gaps keep the retained tail without retrying forever", () => {
    const send = vi.fn();
    const tab = fakeTab();
    const client = new TerminalClient({ send, createTab: () => tab });
    client.applySnapshot({
      terminalId: "t1",
      generation: 1,
      checkpoint: null,
      checkpointWatermark: 0,
      historyGap: true,
      journal: [batch(4, "tail")],
    });
    expect(tab.calls).toEqual(["write:tail", "ack:4"]);
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ payload: { type: "terminal_list" } }),
    );
    client.applyOutput(outputBatch(5, "next"));
    expect(tab.calls).toContain("write:next");
  });

  test("stale exit generation does not remove a replacement tab", () => {
    const tab = fakeTab();
    const client = new TerminalClient({ send: vi.fn(), createTab: () => tab });
    client.applySnapshot(snapshot({ watermark: 0 }));
    expect(client.removeTab("t1", 2)).toBe(false);
    expect(client.tabs.has("t1")).toBe(true);
    expect(client.removeTab("t1", 1)).toBe(true);
    expect(client.tabs.has("t1")).toBe(false);
  });

  test("applyListed replays journal after checkpoint and drops absent tabs", () => {
    const created = {};
    const client = new TerminalClient({
      send: vi.fn(),
      createTab: (id) => (created[id] = fakeTab()),
    });
    // Seed a tab that the next list no longer reports → it must be dropped.
    client.applySnapshot(snapshot({ watermark: 0 }));
    client.applyListed({
      tabs: [
        {
          terminalId: "new",
          generation: 1,
          checkpoint: "snap",
          checkpointWatermark: 2,
          historyGap: false,
          journal: { firstSequence: 3, lastSequence: 3, dataBase64: "three" },
        },
      ],
    });
    expect(client.tabs.has("t1")).toBe(false);
    expect(client.tabs.has("new")).toBe(true);
    expect(created.new.calls).toEqual(["write:snapshot", "write:three", "ack:3"]);
  });

  test("restored metadata does not create a fake xterm tab", () => {
    const client = new TerminalClient({ send: vi.fn(), createTab: vi.fn() });
    client.applyListed({
      tabs: [
        {
          terminalId: "restored-0",
          generation: 0,
          status: "restoredMetadata",
          profileId: "default",
        },
      ],
    });
    expect(client.tabs.size).toBe(0);
    expect(client.createTab).not.toHaveBeenCalled();
  });

  test("sendAndAwait resolves when a matching response arrives", async () => {
    const send = vi.fn();
    const client = new TerminalClient({ send, createTab: fakeTab });
    const promise = client.sendAndAwait(
      { type: "terminal_close", terminalId: "t1", generation: 1 },
      (msg) => msg.type === "terminal_closed" && msg.terminalId === "t1",
    );
    client.resolveResponse({ type: "terminal_closed", terminalId: "t1" });
    expect(await promise).toEqual({ type: "terminal_closed", terminalId: "t1" });
  });

  test("sendAndAwait resolves null on timeout", async () => {
    const client = new TerminalClient({ send: vi.fn(), createTab: fakeTab });
    const promise = client.sendAndAwait(
      { type: "terminal_close", terminalId: "t1", generation: 1 },
      () => false,
      10,
    );
    expect(await promise).toBeNull();
  });
});
