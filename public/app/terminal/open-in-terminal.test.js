// ABOUTME: Tests the Pi tab: its command per shell, the new tab it opens, and the reload on close.
// ABOUTME: The header π opens plain Pi on a new session and never touches the chat.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openPiInTerminal,
  openPiTab,
  piTabCommand,
  waitForShellPrompt,
} from "./open-in-terminal.js";

afterEach(() => vi.unstubAllGlobals());

describe("piTabCommand", () => {
  it("closes the shell only when Pi quits cleanly, in each shell's syntax", () => {
    expect(piTabCommand("D:/Program Files/pi.exe", "powershell", ["/mcp"])).toBe(
      '& "D:/Program Files/pi.exe" /mcp; if ($LASTEXITCODE -eq 0) { exit }',
    );
    expect(piTabCommand("D:\\SPOPI\\resources\\pi\\pi.exe", "git-bash")).toBe(
      "MSYS_NO_PATHCONV=1 D:/SPOPI/resources/pi/pi.exe && exit",
    );
    expect(piTabCommand("", "command-prompt", ["--no-session"])).toBe("pi --no-session && exit");
  });
});

/** @param {string[]} sent */
function fakeClient(sent) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ piBin: "D:/SPOPI/pi.exe" }) })),
  );
  const tabs = new Map([["term-user", { generation: 1, lastAppliedSequence: 99 }]]);
  return {
    tabs,
    command: (payload) => sent.push(payload),
    sendAndAwait: async (payload) => {
      sent.push(payload);
      if (payload.type === "terminal_profiles") {
        return { type: "terminal_profiles", profiles: [{ id: "git-bash", available: true }] };
      }
      if (payload.type === "terminal_create") {
        tabs.set("term-pi", { generation: 2, lastAppliedSequence: 1 });
        return { type: "terminal_created", terminalId: "term-pi" };
      }
      return { type: "terminal_listed" };
    },
  };
}

describe("openPiTab", () => {
  it("opens its own tab named Pi in the user's shell and writes the bundled pi there", async () => {
    const sent = [];
    const panel = { expand: vi.fn(), setActiveTerminalId: vi.fn() };
    const workbench = { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() } };
    const result = await openPiTab({ client: fakeClient(sent), panel, workbench });
    expect(sent.find((payload) => payload.type === "terminal_create")).toEqual({
      type: "terminal_create",
      profileId: "git-bash",
      label: "Pi",
    });
    const input = sent.find((payload) => payload.type === "terminal_input");
    expect(input.terminalId).toBe("term-pi");
    expect(atob(input.dataBase64)).toBe("MSYS_NO_PATHCONV=1 D:/SPOPI/pi.exe && exit\n");
    expect(result).toMatchObject({ wrote: true, terminalId: "term-pi" });
    expect(panel.setActiveTerminalId).toHaveBeenCalledWith("term-pi");
    expect(workbench.dock.setTab).toHaveBeenCalledWith("terminal");
  });

  it("reloads SPOPI's Pi once when that tab closes, and closes the tab", async () => {
    const sent = [];
    await openPiTab({ client: fakeClient(sent) });
    const changed = vi.fn();
    document.addEventListener("spopi-pi-config-changed", changed);
    const closed = (terminalId) =>
      document.dispatchEvent(
        new CustomEvent("spopi-terminal-closed", { detail: { terminalId, generation: 2 } }),
      );
    closed("term-user");
    closed("term-pi");
    closed("term-pi");
    document.removeEventListener("spopi-pi-config-changed", changed);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(sent.filter((payload) => payload.type === "terminal_close")).toEqual([
      { type: "terminal_close", terminalId: "term-pi", generation: 2 },
    ]);
  });
});

describe("openPiInTerminal", () => {
  it("says so when there is no terminal", async () => {
    const notify = vi.fn();
    const result = await openPiInTerminal({ client: null, notify, win: {} });
    expect(result.wrote).toBe(false);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "terminal.piTabFailed" }),
    );
  });
});

describe("waitForShellPrompt", () => {
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
});
