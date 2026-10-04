// ABOUTME: Tests the MCP settings page against the captured list fixtures.
// ABOUTME: A phone error shows the desktop-only line instead of a failure.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalClient } from "../../terminal/terminal-client.js";
import { openMcpManager } from "./mcp-manage-in-pi.js";
import { mountMcpSettings } from "./mcp-settings.js";

const mixed = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/pi-cli/mcp-list-mixed.json"), "utf8"),
);
const empty = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/pi-cli/mcp-list-empty.json"), "utf8"),
);

function host(list, extra = {}) {
  return {
    control: {
      listMcpServers: vi.fn(async () => ({ list })),
      removeMcpServer: vi.fn(async () => {}),
      ...extra.control,
    },
    configGateway: { call: vi.fn(async () => ({ ok: true, data: extra.trust ?? {} })) },
    getWorkspaceId: () => "ws",
  };
}

/** A terminal client whose host answers create, list, and profiles at once. */
function fakeTerminal(terminalId) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ piBin: "pi" }) })),
  );
  const sent = [];
  const client = new TerminalClient({
    send: (envelope) => {
      const payload = envelope.payload;
      sent.push(payload);
      const reply = (message) => queueMicrotask(() => client.resolveResponse(message));
      if (payload.type === "terminal_profiles") {
        reply({
          type: "terminal_profiles",
          profiles: [
            { id: "git-bash", available: true },
            { id: "powershell", available: true },
          ],
        });
      }
      if (payload.type === "terminal_create") {
        client.tabs.set(terminalId, { generation: 1, lastAppliedSequence: 1 });
        reply({ type: "terminal_created", terminalId });
      }
      if (payload.type === "terminal_list") reply({ type: "terminal_listed" });
      return envelope.requestId;
    },
    createTab: () => ({}),
  });
  client.setWorkspaceGeneration(0);
  const panel = { setActiveTerminalId: vi.fn(), expand: vi.fn() };
  return { client, panel, sent };
}

/** @param {string} text */
function menuItem(text) {
  return [...document.querySelectorAll(".context-menu-item")].find((row) =>
    row.textContent.includes(text),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mcp settings page", () => {
  it("renders rows, dots, counts, errors, and the empty state", async () => {
    document.body.innerHTML =
      '<div id="root"></div><div id="dialog-container" class="hidden"></div>';
    const root = document.getElementById("root");
    const deps = host(mixed);
    const page = mountMcpSettings(root, deps);
    await page.reload();
    expect(root.querySelector("[data-server='echo'] .mcp-dot--ok")).not.toBeNull();
    expect(root.querySelector("[data-server='remote'] .mcp-dot--warn")).not.toBeNull();
    expect(root.querySelector("[data-server='broken'] .mcp-dot--error")).not.toBeNull();
    expect(root.querySelector("[data-server='off'] .mcp-dot--off")).not.toBeNull();
    expect(root.textContent).toContain("settings.mcp.tools");
    expect(root.textContent).toContain(mixed.errors[0]);
    expect(root.querySelector("[data-server='echo']").textContent).not.toContain(
      "settings.mcp.manage",
    );
    expect(root.querySelector("[data-server='echo'] .mcp-row-more")).not.toBeNull();
    expect(root.querySelector("[data-server='echo'] .mcp-row-override").textContent).toBe(
      "settings.mcp.override",
    );
    expect(root.querySelectorAll(".mcp-row-override")).toHaveLength(1);
    const cards = root.querySelectorAll(".mcp-page > .settings-section.ui-card");
    expect(cards[0].querySelector(".mcp-header-actions .mcp-checked")).not.toBeNull();
    expect(cards[0].querySelector(".mcp-header-actions").textContent).toContain(
      "settings.mcp.permissionsLink",
    );
    expect(cards[1].querySelector(".settings-section-title").textContent).toBe(
      "settings.mcp.global",
    );
    expect(cards[1].querySelector("[data-server='echo']")).not.toBeNull();
    const extension = {
      ...mixed,
      servers: [
        {
          name: "from-pkg",
          scope: "extension",
          state: "connected",
          tools: ["a"],
          transport: "ext",
        },
      ],
    };
    deps.control.listMcpServers.mockResolvedValue({ list: extension });
    await page.reload();
    expect(root.querySelector("[data-server='from-pkg'] button")).toBeNull();
    deps.control.listMcpServers.mockResolvedValue({ list: empty });
    await page.reload();
    expect(root.querySelector(".mcp-examples").textContent).toContain(
      "settings.mcp.exampleCommand",
    );
    expect(root.querySelectorAll(".mcp-page > .settings-section")).toHaveLength(1);
    page.destroy();
  });

  it("runs one list at a time, disables buttons, and removes from the row menu", async () => {
    document.body.innerHTML =
      '<div id="root"></div><div id="dialog-container" class="hidden"></div>';
    const root = document.getElementById("root");
    let release;
    const listMcpServers = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const deps = host(mixed, { control: { listMcpServers } });
    const page = mountMcpSettings(root, deps);
    const pending = page.reload();
    const again = page.reload();
    expect(listMcpServers).toHaveBeenCalledTimes(1);
    expect(root.querySelector("button").disabled).toBe(true);
    release({ list: mixed });
    await Promise.all([pending, again]);
    expect(root.querySelector("button").disabled).toBe(false);

    root.querySelector("[data-server='echo'] .mcp-row-more").click();
    expect(menuItem("settings.mcp.signOut")).toBeUndefined();
    menuItem("settings.mcp.remove").click();
    await vi.waitFor(() =>
      expect(document.querySelector("#dialog-container .ui-button--danger")).not.toBeNull(),
    );
    document.querySelector("#dialog-container .ui-button--danger").click();
    await vi.waitFor(() =>
      expect(deps.control.removeMcpServer).toHaveBeenCalledWith("echo", "global", {
        workspaceId: "ws",
      }),
    );
    page.destroy();
  });

  it("shows the trust note and the desktop-only line", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById("root");
    const noted = { ...empty, note: "ignored because the project is not trusted" };
    const deps = host(noted, { trust: { sessionTrusted: true, savedTrust: null } });
    const page = mountMcpSettings(root, deps);
    await page.reload();
    expect(root.textContent).toContain("settings.mcp.trustNote");
    deps.control.listMcpServers.mockRejectedValue(new Error("This device cannot run that action"));
    await page.reload();
    expect(root.textContent).toContain("settings.mcp.desktopOnly");
    expect(root.textContent).not.toContain("cannot run that action");
    page.destroy();
  });

  it("opens Pi's manager in the user's shell and reloads once when that tab closes", async () => {
    const { client, panel, sent } = fakeTerminal("t9");
    const notify = vi.fn();
    const closeSettings = vi.fn();
    const workbench = { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() } };
    await openMcpManager({ terminal: { client, panel }, workbench, notify, closeSettings });
    expect(sent.find((payload) => payload.type === "terminal_create").profileId).toBe("git-bash");
    const input = sent.find((payload) => payload.type === "terminal_input");
    expect(atob(input.dataBase64)).toBe(
      "MSYS_NO_PATHCONV=1 pi --no-session --approve /mcp && exit\n",
    );
    expect(input.terminalId).toBe("t9");
    expect(panel.expand).toHaveBeenCalled();
    expect(panel.setActiveTerminalId).toHaveBeenCalledWith("t9");
    expect(workbench.dock.setTab).toHaveBeenCalledWith("terminal");
    expect(closeSettings).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));

    const changed = vi.fn();
    document.addEventListener("spopi-pi-config-changed", changed);
    const closed = (terminalId) =>
      document.dispatchEvent(
        new CustomEvent("spopi-terminal-closed", { detail: { terminalId, generation: 1 } }),
      );
    closed("other");
    closed("t9");
    closed("t9");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(sent.filter((payload) => payload.type === "terminal_close")).toEqual([
      { type: "terminal_close", terminalId: "t9", generation: 1 },
    ]);
    document.removeEventListener("spopi-pi-config-changed", changed);

    closeSettings.mockClear();
    await openMcpManager({ terminal: null, notify, closeSettings });
    expect(closeSettings).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "error", message: "settings.mcp.manageFailed" }),
    );
  });

  it("the header Manage button closes Settings and starts a PTY", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById("root");
    const { client, panel, sent } = fakeTerminal("t2");
    const closeSettings = vi.fn();
    const page = mountMcpSettings(root, {
      ...host(empty),
      closeSettings,
      workbench: { dock: { setTab: vi.fn() }, shell: { applyHidden: vi.fn() } },
      terminal: { client, panel },
    });
    await page.reload();
    const manage = [...root.querySelectorAll(".mcp-header-actions button")].find((button) =>
      button.textContent.includes("settings.mcp.manage"),
    );
    manage.click();
    await vi.waitFor(() => expect(closeSettings).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(sent.some((payload) => payload.type === "terminal_input")).toBe(true),
    );
    page.destroy();
  });

  it("adds a stdio server with its arguments as a list", async () => {
    document.body.innerHTML =
      '<div id="root"></div><div id="dialog-container" class="hidden"></div>';
    const root = document.getElementById("root");
    const addMcpServer = vi.fn(async () => {});
    const deps = host(mixed, { control: { addMcpServer } });
    const page = mountMcpSettings(root, deps);
    await page.reload();
    root.querySelector(".mcp-header-actions .ui-button--primary").click();
    const dialog = document.querySelector("#dialog-container .dialog");
    const [name, command, arg] = dialog.querySelectorAll("input.ui-input");
    const submit = dialog.querySelector(".dialog-actions .ui-button--primary");
    expect(submit.disabled).toBe(true);
    name.value = "echo";
    name.dispatchEvent(new Event("input"));
    expect(submit.textContent).toBe("settings.mcp.replace");
    name.value = "new-one";
    name.dispatchEvent(new Event("input"));
    command.value = "node";
    command.dispatchEvent(new Event("input"));
    arg.value = "server path.mjs";
    submit.click();
    await vi.waitFor(() => expect(addMcpServer).toHaveBeenCalled());
    expect(addMcpServer.mock.calls[0][0]).toMatchObject({
      name: "new-one",
      scope: "global",
      kind: "stdio",
      command: "node",
      args: ["server path.mjs"],
    });
    page.destroy();
  });
});
