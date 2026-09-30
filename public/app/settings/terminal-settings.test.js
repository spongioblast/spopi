// ABOUTME: Tests the Terminal settings page mount and preference round-trip.
// ABOUTME: A changed row is stored, and a later reconcile paints the stored value.

import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../i18n/i18n.js", () => ({
  t: (key) => key,
  onLocaleChange: () => () => {},
  translateSubtree: () => {},
}));

import { loadAppearanceCookie, saveAppearanceCookie } from "./appearance-preferences.js";
import { mountTerminalSettings } from "./terminal-settings.js";

function fakePreferences(db = {}) {
  return {
    get: vi.fn(async (key) => (key in db ? db[key] : null)),
    set: vi.fn(async () => {}),
  };
}

function fakeTerminal() {
  return { applyPreferences: vi.fn() };
}

function clearAppearanceState() {
  document.cookie = "spopi-appearance=; Max-Age=0; Path=/";
}

beforeEach(() => {
  clearAppearanceState();
});

afterEach(() => {
  for (const node of document.querySelectorAll(".ui-select-popover")) node.remove();
  document.body.innerHTML = "";
  clearAppearanceState();
});

function mount(deps) {
  const root = document.createElement("div");
  document.body.append(root);
  return { root, page: mountTerminalSettings(root, deps) };
}

test("terminal page renders shell, theme, font, scrollback, and WebGL rows", () => {
  const { root } = mount({ preferences: fakePreferences(), terminal: fakeTerminal() });
  const heading = root.querySelector("[data-i18n='settings.terminal.title']");
  expect(heading?.textContent).toBe("settings.terminal.title");
  expect(root.querySelector("#settings-terminal-profile-select")).not.toBeNull();
  expect(root.querySelector("#settings-terminal-theme-select")).not.toBeNull();
  expect(root.querySelector("#settings-terminal-font-size")).not.toBeNull();
  expect(root.querySelector("#settings-terminal-scrollback-input")).not.toBeNull();
  expect(root.querySelector("#settings-terminal-smooth-scroll-input")).not.toBeNull();
  expect(root.querySelector("#toggle-terminal-webgl")).not.toBeNull();
});

test("scrollback change persists and reconcile paints the stored value", async () => {
  const preferences = fakePreferences({ "ui.terminalScrollbackLimit": 4000 });
  const terminal = fakeTerminal();
  const { root, page } = mount({ preferences, terminal });
  const scrollback = root.querySelector("#settings-terminal-scrollback-input");
  scrollback.value = "250";
  scrollback.dispatchEvent(new Event("change"));
  await Promise.resolve();
  expect(loadAppearanceCookie().terminalScrollbackLimit).toBe(250);
  expect(preferences.set).toHaveBeenCalledWith("ui.terminalScrollbackLimit", 250);
  expect(terminal.applyPreferences).toHaveBeenCalledWith({ scrollbackLimit: 250 });

  await page.refresh();
  expect(root.querySelector("#settings-terminal-scrollback-input").value).toBe("4000");
});

test("a stored dark theme without the migration flag resets once to system", async () => {
  const preferences = fakePreferences({ "ui.terminalThemeMode": "dark" });
  const terminal = fakeTerminal();
  saveAppearanceCookie({ terminalThemeMode: "dark" });
  const { page } = mount({ preferences, terminal });
  await page.refresh();
  expect(loadAppearanceCookie().terminalThemeMode).toBe("system");
  expect(loadAppearanceCookie().terminalThemeModeMigrated).toBe(true);
  expect(preferences.set).toHaveBeenCalledWith("ui.terminalThemeMode", "system");
  expect(preferences.set).toHaveBeenCalledWith("ui.terminalThemeModeMigrated", true);

  preferences.get.mockImplementation(async (key) =>
    key === "ui.terminalThemeModeMigrated" ? true : key === "ui.terminalThemeMode" ? "dark" : null,
  );
  saveAppearanceCookie({ terminalThemeMode: "dark", terminalThemeModeMigrated: true });
  await page.refresh();
  expect(loadAppearanceCookie().terminalThemeMode).toBe("dark");
});

test("font, theme, shell, smooth scroll, and WebGL apply to the terminal", async () => {
  const preferences = fakePreferences();
  const terminal = fakeTerminal();
  terminal.listProfiles = vi.fn(async () => ({
    profiles: [
      { id: "git-bash", label: "Git Bash", available: true },
      { id: "powershell", label: "PowerShell", available: true },
    ],
  }));
  saveAppearanceCookie({ terminalDefaultProfile: "default" });
  const { root } = mount({ preferences, terminal });

  root.querySelector('#settings-terminal-font-size [data-level="xlarge"]').click();
  await Promise.resolve();
  expect(terminal.applyPreferences).toHaveBeenCalledWith({ fontSize: 18 });

  const theme = root.querySelector("#settings-terminal-theme-select");
  theme.value = "light";
  theme.dispatchEvent(new Event("change"));
  await Promise.resolve();
  expect(terminal.applyPreferences).toHaveBeenCalledWith({ themeMode: "light" });

  await vi.waitFor(() => expect(loadAppearanceCookie().terminalDefaultProfile).toBe("git-bash"));
  const profile = root.querySelector("#settings-terminal-profile-select");
  profile.value = "powershell";
  profile.dispatchEvent(new Event("change"));
  await Promise.resolve();
  expect(preferences.set).toHaveBeenCalledWith("ui.terminalDefaultProfile", "powershell");

  const smooth = root.querySelector("#settings-terminal-smooth-scroll-input");
  smooth.value = "80";
  smooth.dispatchEvent(new Event("change"));
  await Promise.resolve();
  expect(terminal.applyPreferences).toHaveBeenCalledWith({ smoothScrollDuration: 80 });

  root.querySelector("#toggle-terminal-webgl").click();
  await Promise.resolve();
  expect(loadAppearanceCookie().terminalWebglRenderer).toBe(true);
  expect(terminal.applyPreferences).toHaveBeenCalledWith({ webglRenderer: true });
});
