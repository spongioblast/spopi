// ABOUTME: Tests run-file.
// ABOUTME: Includes "maps runnable extensions and leaves .rs as null".
// ABOUTME: Run-file mapping table and PTY write behavior. Never sends a prompt.

import { afterEach, expect, test, vi } from "vitest";
import { runCommandForFile, runFileInTerminal, writeCommandToPty } from "./run-file.js";

afterEach(() => {
  document.body.textContent = "";
});

test("maps runnable extensions and leaves .rs as null", () => {
  expect(runCommandForFile("src/app.py")).toEqual({
    command: 'python "src/app.py"',
    label: "Python",
  });
  expect(runCommandForFile("bin/cli.js")).toEqual({ command: 'node "bin/cli.js"', label: "Node" });
  expect(runCommandForFile("tool.ts")).toEqual({ command: 'bun "tool.ts"', label: "Bun" });
  expect(runCommandForFile("setup.sh")).toEqual({ command: 'bash "setup.sh"', label: "Bash" });
  expect(runCommandForFile("build.ps1")).toEqual({
    command: 'pwsh -File "build.ps1"',
    label: "PowerShell",
  });
  expect(runCommandForFile("run.cmd", { platform: "Win32" })).toEqual({
    command: 'cmd /c "run.cmd"',
    label: "Command Prompt",
  });
  expect(runCommandForFile("run.cmd", { platform: "MacIntel" })).toBeNull();
  expect(runCommandForFile("main.go")).toEqual({ command: 'go run "main.go"', label: "Go" });
  expect(runCommandForFile("src/lib.rs")).toBeNull();
});

test("writeCommandToPty encodes the command as terminal_input", () => {
  const command = vi.fn();
  const client = {
    command,
    tabs: new Map([["t1", { generation: 3 }]]),
  };
  const result = writeCommandToPty(client, 'python "a.py"');
  expect(result.wrote).toBe(true);
  expect(command).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "terminal_input",
      terminalId: "t1",
      generation: 3,
    }),
  );
});

test("runFileInTerminal creates a shell only when none is running", async () => {
  const command = vi.fn();
  const client = {
    command,
    sendAndAwait: null,
    tabs: new Map(),
  };
  const sendAndAwait = vi.fn(async (payload) => {
    if (payload.type === "terminal_create") {
      client.tabs.set("new", { generation: 1, lastAppliedSequence: 1 });
      return { type: "terminal_created", terminalId: "new" };
    }
    return null;
  });
  client.sendAndAwait = sendAndAwait;
  const panel = { tabs: [], setActiveTerminalId: vi.fn() };
  const workbench = { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() } };
  await runFileInTerminal({
    client,
    panel,
    workbench,
    path: "demo.py",
    getDefaultProfile: () => "powershell",
  });
  expect(workbench.dock.setTab).toHaveBeenCalledWith("terminal");
  expect(sendAndAwait).toHaveBeenCalledWith(
    { type: "terminal_create", profileId: "powershell" },
    expect.any(Function),
  );

  sendAndAwait.mockClear();
  client.tabs = new Map([["live", { generation: 1, lastAppliedSequence: 2 }]]);
  panel.tabs = [{ terminalId: "live", status: "running" }];
  panel.activeTerminalId = "live";
  await runFileInTerminal({ client, panel, workbench, path: "demo.py" });
  expect(sendAndAwait).not.toHaveBeenCalled();
  expect(command).toHaveBeenCalled();
});

test("runFileInTerminal waits for the prompt of a shell that just started", async () => {
  const command = vi.fn();
  let text = false;
  const entry = { generation: 1, lastAppliedSequence: 3, tab: { hasScreenText: () => text } };
  const client = { command, tabs: new Map([["fresh", entry]]) };
  const panel = {
    tabs: [{ terminalId: "fresh", status: "running" }],
    setActiveTerminalId: vi.fn(),
  };
  const workbench = { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() } };
  const running = runFileInTerminal({ client, panel, workbench, path: "todo.js" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(command).not.toHaveBeenCalled();
  text = true;
  entry.lastAppliedSequence = 5;
  const result = await running;
  expect(result).toMatchObject({ wrote: true, command: 'node "todo.js"', terminalId: "fresh" });
});

test("runFileInTerminal never sends a chat prompt", async () => {
  const sendPrompt = vi.fn();
  await runFileInTerminal({
    client: { command: vi.fn(), tabs: new Map() },
    panel: { tabs: [] },
    workbench: { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() }, sendPrompt },
    path: "demo.py",
  });
  expect(sendPrompt).not.toHaveBeenCalled();
});
