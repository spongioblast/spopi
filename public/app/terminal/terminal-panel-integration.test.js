// ABOUTME: Guards the terminal host-frame seam: spawn failures must refresh
// ABOUTME: the tab list and surface the error instead of leaving an empty panel.

import { afterEach, expect, test, vi } from "vitest";
import { TerminalPanel } from "../dock/terminal-panel.js";
import { TerminalClient } from "./terminal-client.js";
import { formatTerminalStartError, handleTerminalFrame } from "./terminal-panel-integration.js";

vi.mock("../i18n/i18n.js", () => ({
  t: (key) => key,
  onLocaleChange: () => () => {},
}));

afterEach(() => {
  document.body.textContent = "";
});

function mounted() {
  const send = vi.fn();
  const panel = new TerminalPanel({
    enabled: true,
    client: { create: vi.fn() },
  });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  const client = new TerminalClient({
    send,
    createTab: () => ({
      writeSnapshot() {},
      writeOutput() {},
      ack() {},
      destroy() {},
    }),
  });
  client.setWorkspaceGeneration(0);
  return { panel, client, send };
}

test("terminal_command_failed requests a fresh list and shows the host error", () => {
  const { panel, client, send } = mounted();
  handleTerminalFrame(
    {
      type: "error",
      error: {
        code: "terminal_command_failed",
        message: "Git for Windows was not found. Install Git for Windows.",
      },
    },
    client,
    panel,
  );
  expect(panel.bodyEl.querySelector("[data-terminal-start-error]").textContent).toBe(
    "terminal.gitBashMissing",
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: { type: "terminal_list" },
    }),
  );
});

test("unrelated error frames do not collapse or list the terminal", () => {
  const { panel, client, send } = mounted();
  handleTerminalFrame(
    { type: "error", error: { code: "auth_failed", message: "nope" } },
    client,
    panel,
  );
  expect(panel.bodyEl.querySelector("[data-terminal-start-error]")).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

test("listed failed tabs keep the host failReason on the panel", () => {
  const { panel, client } = mounted();
  handleTerminalFrame(
    {
      type: "terminal_listed",
      tabs: [
        {
          terminalId: "t-fail",
          generation: 1,
          label: "Terminal",
          profileId: "default",
          status: "failed",
          failReason: "pty spawn failed: CreateProcess",
        },
      ],
    },
    client,
    panel,
  );
  expect(panel.bodyEl.querySelector("[data-terminal-start-error]").textContent).toBe(
    "pty spawn failed: CreateProcess",
  );
});

test("docked empty listed retries expand so a PTY is created after connect", () => {
  const create = vi.fn();
  const panel = new TerminalPanel({ enabled: true, docked: true, client: { create } });
  panel.mount({ toggleContainer: document.body, panelContainer: document.body });
  handleTerminalFrame(
    { type: "terminal_listed", tabs: [] },
    new TerminalClient({ send: vi.fn() }),
    panel,
  );
  expect(create).toHaveBeenCalledWith("default");
});

test("formatTerminalStartError maps Git-for-Windows guidance to the locale key", () => {
  expect(formatTerminalStartError("Git for Windows was not found.")).toBe(
    "terminal.gitBashMissing",
  );
  expect(formatTerminalStartError("pty spawn failed")).toBe("pty spawn failed");
});
