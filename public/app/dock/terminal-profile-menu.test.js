// ABOUTME: Profile menu wraps the + button, marks the default, and creates
// ABOUTME: the chosen profile without sending a chat prompt.

import { afterEach, expect, test, vi } from "vitest";
import { saveAppearanceCookie } from "../settings/appearance-preferences.js";
import { defaultTerminalProfile, mountTerminalProfileMenu } from "./terminal-profile-menu.js";

vi.mock("../i18n/i18n.js", () => ({ t: (key) => key }));
vi.mock("../ui/context-menu.js", () => ({
  showContextMenu: vi.fn(),
  registerContextMenuHost: vi.fn(),
}));
vi.mock("../settings/settings-panel.js", () => ({ openSettingsTab: vi.fn() }));

import { openSettingsTab } from "../settings/settings-panel.js";
import { showContextMenu } from "../ui/context-menu.js";

afterEach(() => {
  document.body.textContent = "";
  document.cookie = "spopi-appearance=; Max-Age=0; Path=/";
  vi.clearAllMocks();
});

test("defaultTerminalProfile reads the appearance cookie", () => {
  saveAppearanceCookie({ terminalDefaultProfile: "powershell" });
  expect(defaultTerminalProfile()).toBe("powershell");
});

test("chevron opens a menu of available profiles and creates the chosen one", async () => {
  const button = document.createElement("button");
  button.dataset.terminalNewTab = "";
  document.body.appendChild(button);
  const create = vi.fn();
  mountTerminalProfileMenu({
    button,
    create,
    listProfiles: async () => ({
      profiles: [
        { id: "default", label: "Default", available: true },
        { id: "powershell", label: "PowerShell", available: true },
        { id: "git-bash", label: "Git Bash", available: false, guidance: "missing" },
      ],
    }),
  });
  expect(button.closest(".terminal-new-tab-group")).not.toBeNull();
  const chevron = document.querySelector("[data-terminal-new-tab-menu]");
  expect(chevron).not.toBeNull();
  saveAppearanceCookie({ terminalDefaultProfile: "default" });
  chevron.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 8, clientY: 8 }));
  await vi.waitFor(() => expect(showContextMenu).toHaveBeenCalled());
  const items = showContextMenu.mock.calls[0][0].items;
  expect(items[0].label).toBe("PowerShell");
  expect(items[0].hint).toBeTruthy();
  expect(items[1].hint).toBeUndefined();
  expect(items[1].disabled).toBe(true);
  items[0].action();
  expect(create).toHaveBeenCalledWith("powershell");
  items.at(-1).action();
  expect(openSettingsTab).toHaveBeenCalledWith("terminal");
});
