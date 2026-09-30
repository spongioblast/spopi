// ABOUTME: Tests resumeSessionCommand.
// ABOUTME: Includes "always quotes and uses forward slashes".
import { describe, expect, it, vi } from "vitest";
import { emitSessionCreated } from "../session/session-created-action.js";
import {
  awaitSessionSwitch,
  ensureResumeInPty,
  normalizeSessionPath,
  openSessionInPtyTwin,
  resolveResumePath,
  resumeSessionCommand,
  shouldSwitchToFreshSession,
  waitForShellPrompt,
  waitUntilConnected,
  writeResumeToPty,
} from "./open-in-terminal.js";

describe("resumeSessionCommand", () => {
  it("always quotes and uses forward slashes", () => {
    expect(resumeSessionCommand("D:/work/session.jsonl")).toBe('pi -r "D:/work/session.jsonl"');
    expect(resumeSessionCommand("D:/my work/session.jsonl")).toBe(
      'pi -r "D:/my work/session.jsonl"',
    );
    expect(resumeSessionCommand("C:\\Users\\me\\.pi\\agent\\sessions\\x\\s.jsonl")).toBe(
      'pi -r "C:/Users/me/.pi/agent/sessions/x/s.jsonl"',
    );
    expect(resumeSessionCommand("")).toBe("pi");
    expect(resumeSessionCommand("D:/work/session.jsonl", "D:/SPOPI/resources/pi/pi.exe")).toBe(
      'D:/SPOPI/resources/pi/pi.exe -r "D:/work/session.jsonl"',
    );
    expect(
      resumeSessionCommand("D:/work/session.jsonl", "D:/Program Files/SPOPI/resources/pi/pi.exe"),
    ).toBe('"D:/Program Files/SPOPI/resources/pi/pi.exe" -r "D:/work/session.jsonl"');
  });

  it("normalizes backslashes without touching the rest", () => {
    expect(normalizeSessionPath(" C:\\a\\b.jsonl ")).toBe("C:/a/b.jsonl");
  });
});

describe("shouldSwitchToFreshSession", () => {
  it("switches by default because the GUI holds the shown session", () => {
    expect(shouldSwitchToFreshSession({ held: true, sameProcess: false })).toBe(true);
    expect(shouldSwitchToFreshSession({})).toBe(true);
    expect(shouldSwitchToFreshSession({ held: false })).toBe(false);
    expect(shouldSwitchToFreshSession({ sameProcess: true })).toBe(false);
  });
});

describe("awaitSessionSwitch", () => {
  it("resolves on spopi:session-created with a different session id", async () => {
    const target = new EventTarget();
    const pending = awaitSessionSwitch(target, { fromSessionId: "old", timeoutMs: 1000 });
    emitSessionCreated({ sessionId: "old" });
    emitSessionCreated({ sessionId: "new" });
    await expect(pending).resolves.toEqual({ switched: true, sessionId: "new" });
  });

  it("gives up after the timeout instead of hanging", async () => {
    const target = new EventTarget();
    await expect(awaitSessionSwitch(target, { timeoutMs: 5 })).resolves.toEqual({
      switched: false,
      sessionId: null,
    });
  });
});

describe("openSessionInPtyTwin", () => {
  it("switches the GUI to a fresh session before the PTY writes pi -r", async () => {
    const win = new EventTarget();
    const order = [];
    const button = {
      click: () => {
        order.push("new-session");
        emitSessionCreated({ sessionId: "fresh" });
      },
    };
    const doc = {
      getElementById: (id) => {
        if (id === "new-session-btn") return button;
        if (id === "status-text") return { textContent: "Connected" };
        return null;
      },
    };
    const tabs = new Map();
    const client = {
      command: (payload) => order.push(payload.type),
      tabs,
      sendAndAwait: async (payload) => {
        if (payload.type === "terminal_create") {
          order.push("terminal_create");
          tabs.set("term-1", { generation: 1, lastAppliedSequence: 1 });
          return { type: "terminal_created", terminalId: "term-1" };
        }
        return { type: "terminal_listed" };
      },
    };
    const workbench = { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() } };
    const panel = { setActiveTerminalId: vi.fn() };
    const result = await openSessionInPtyTwin({
      workbench,
      getClient: () => client,
      getPanel: () => panel,
      sessionPath: "C:\\s\\old.jsonl",
      currentSessionId: "old",
      win,
      doc,
    });
    expect(order).toEqual(["new-session", "terminal_create", "terminal_input"]);
    expect(result).toMatchObject({ wrote: true, switched: true, sessionId: "fresh" });
    expect(result.command).toBe('pi -r "C:/s/old.jsonl"');
    expect(workbench.dock.setTab).toHaveBeenCalledWith("terminal");
    expect(panel.setActiveTerminalId).toHaveBeenCalledWith("term-1");
  });
});

describe("resolveResumePath", () => {
  it("keeps a real path and asks Pi only when empty", async () => {
    const requestStats = vi.fn(async () => ({ data: { sessionFile: "C:\\s\\from-stats.jsonl" } }));
    expect(await resolveResumePath("C:\\s\\given.jsonl", requestStats)).toBe("C:/s/given.jsonl");
    expect(requestStats).not.toHaveBeenCalled();
    expect(await resolveResumePath("", requestStats)).toBe("C:/s/from-stats.jsonl");
  });
});

describe("waitUntilConnected", () => {
  it("resolves once #status-text is Connected", async () => {
    const doc = {
      getElementById: () => ({ textContent: "Connected" }),
    };
    await expect(waitUntilConnected(doc, { timeoutMs: 200 })).resolves.toBe(true);
  });
});

describe("writeResumeToPty", () => {
  it("sends the resume line to the PTY, not a chat prompt", () => {
    const command = vi.fn();
    const client = {
      command,
      tabs: new Map([["term-1", { generation: 3 }]]),
    };
    const result = writeResumeToPty(client, "D:/work/session.jsonl");
    expect(result.wrote).toBe(true);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "terminal_input", terminalId: "term-1" }),
    );
    expect(command.mock.calls[0][0].type).not.toBe("prompt");
    const decoded = atob(command.mock.calls[0][0].dataBase64);
    expect(decoded).toBe('pi -r "D:/work/session.jsonl"\n');
  });
});

describe("ensureResumeInPty", () => {
  it("creates a tab, waits for the shell prompt, then writes", async () => {
    const command = vi.fn();
    const tabs = new Map();
    const client = {
      command,
      tabs,
      sendAndAwait: vi.fn(async (payload) => {
        if (payload.type === "terminal_create") {
          const entry = { generation: 1, lastAppliedSequence: 0 };
          tabs.set("term-1", entry);
          // Shell output arrives a little later, like a real PTY.
          setTimeout(() => {
            entry.lastAppliedSequence = 3;
          }, 60);
          return { type: "terminal_created" };
        }
        return { type: "terminal_listed" };
      }),
    };
    const result = await ensureResumeInPty(client, "D:/work/session.jsonl");
    expect(tabs.get("term-1").lastAppliedSequence).toBe(3);
    expect(result.wrote).toBe(true);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "terminal_input", terminalId: "term-1" }),
    );
    expect(command.mock.calls.every((call) => call[0].type !== "prompt")).toBe(true);
  });

  it("opens a dedicated tab even when the user already has one, and writes there", async () => {
    const command = vi.fn();
    const busy = { generation: 1, lastAppliedSequence: 99 };
    const tabs = new Map([["term-user", busy]]);
    const client = {
      command,
      tabs,
      sendAndAwait: vi.fn(async (payload) => {
        if (payload.type === "terminal_create") {
          tabs.set("term-twin", { generation: 1, lastAppliedSequence: 1 });
          return { type: "terminal_created", terminalId: "term-twin" };
        }
        return { type: "terminal_listed" };
      }),
    };
    const result = await ensureResumeInPty(client, "D:/work/s.jsonl");
    expect(result).toMatchObject({ wrote: true, terminalId: "term-twin" });
    expect(command.mock.calls[0][0].terminalId).toBe("term-twin");
  });

  it("gives up waiting for a silent shell instead of hanging", async () => {
    const tabs = new Map([["term-1", { generation: 1, lastAppliedSequence: 0 }]]);
    expect(await waitForShellPrompt({ tabs }, { timeoutMs: 40, pollMs: 10 })).toBe(false);
  });

  it("does not count ConPTY mode switches on a blank screen as the prompt", async () => {
    let text = false;
    const entry = { generation: 1, lastAppliedSequence: 3, tab: { hasScreenText: () => text } };
    const tabs = new Map([["term-1", entry]]);
    const options = { timeoutMs: 60, pollMs: 10, quietMs: 20 };
    expect(await waitForShellPrompt({ tabs }, options)).toBe(false);
    text = true;
    entry.lastAppliedSequence = 5;
    expect(await waitForShellPrompt({ tabs }, options)).toBe(true);
  });

  it("waits for a prompt painted in pieces to finish", async () => {
    const entry = { generation: 1, lastAppliedSequence: 1, tab: { hasScreenText: () => true } };
    const tabs = new Map([["term-1", entry]]);
    const timer = setInterval(() => {
      entry.lastAppliedSequence += 1;
    }, 5);
    const started = Date.now();
    setTimeout(() => clearInterval(timer), 60);
    expect(await waitForShellPrompt({ tabs }, { pollMs: 10, quietMs: 30 })).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });

  it("does not invent a chat prompt when no client exists", async () => {
    const result = await ensureResumeInPty(null, "D:/work/session.jsonl");
    expect(result.wrote).toBe(false);
    expect(result.command).toBe('pi -r "D:/work/session.jsonl"');
  });
});
