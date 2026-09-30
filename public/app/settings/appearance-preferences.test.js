// ABOUTME: Tests appearance-preferences.js level tables and normalization.
// ABOUTME: Covers the cookie round-trip and first-paint DOM application.

import { afterEach, describe, expect, test } from "vitest";
import {
  applyAppearanceToDom,
  CHAT_FONT_SIZE_PX,
  DEFAULT_FONT_SIZE_LEVEL,
  DEFAULT_PREVIEW_THEME_MODE,
  DEFAULT_SCROLLBACK_LIMIT,
  DEFAULT_TERMINAL_PROFILE,
  DEFAULT_TERMINAL_THEME_MODE,
  defaultWebglRenderer,
  FONT_SIZE_LEVELS,
  loadAppearanceCookie,
  migrateTerminalThemeCookie,
  normalizeFontLevel,
  normalizePreviewThemeMode,
  normalizeScrollbackLimit,
  normalizeSmoothScrollDuration,
  normalizeTerminalProfile,
  normalizeThemeMode,
  PREVIEW_FONT_SIZE_PX,
  resolvePreviewTheme,
  saveAppearanceCookie,
  selectedShellProfile,
  shellProfileChoices,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_THEME_MODES,
} from "./appearance-preferences.js";

const COOKIE_KEY = "spopi-appearance";

function clearCookie() {
  document.cookie = `${COOKIE_KEY}=; Max-Age=0; Path=/`;
}

afterEach(() => {
  clearCookie();
  document.documentElement.removeAttribute("data-preview-theme");
  for (const name of ["--chat-font-size", "--preview-font-size"]) {
    document.documentElement.style.removeProperty(name);
  }
});

describe("appearance level tables", () => {
  test("exposes five levels with source-compatible px maps", () => {
    expect(FONT_SIZE_LEVELS).toEqual(["small", "normal", "medium", "large", "xlarge"]);
    expect(DEFAULT_FONT_SIZE_LEVEL).toBe("normal");
    expect(CHAT_FONT_SIZE_PX).toEqual({ small: 12, normal: 13, medium: 14, large: 16, xlarge: 18 });
    expect(PREVIEW_FONT_SIZE_PX).toEqual({
      small: 11,
      normal: 13,
      medium: 15,
      large: 17,
      xlarge: 19,
    });
    expect(TERMINAL_FONT_SIZE_PX).toEqual({
      small: 12,
      normal: 13,
      medium: 14,
      large: 16,
      xlarge: 18,
    });
    expect(DEFAULT_PREVIEW_THEME_MODE).toBe("system");
    expect(DEFAULT_TERMINAL_THEME_MODE).toBe("system");
    expect(TERMINAL_THEME_MODES).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_TERMINAL_PROFILE).toBe("default");
    expect(DEFAULT_SCROLLBACK_LIMIT).toBe(1000);
  });

  test("normalizes unknown values to defaults", () => {
    expect(normalizeFontLevel("huge")).toBe("normal");
    expect(normalizePreviewThemeMode("sepia")).toBe("system");
    expect(normalizeThemeMode("sepia")).toBe("system");
    expect(normalizeTerminalProfile("powershell")).toBe("powershell");
    expect(normalizeTerminalProfile("bogus")).toBe("default");
    expect(
      shellProfileChoices([
        { id: "default", label: "Default", available: true },
        { id: "git-bash", label: "Git Bash", available: true },
        { id: "powershell", label: "PowerShell", available: true },
      ]).map((profile) => profile.id),
    ).toEqual(["git-bash", "powershell"]);
    expect(
      selectedShellProfile("default", [
        { id: "default", available: true },
        { id: "git-bash", available: true },
        { id: "powershell", available: true },
      ]),
    ).toBe("git-bash");
    expect(
      selectedShellProfile("default", [{ id: "default", label: "zsh", available: true }]),
    ).toBe("default");
    expect(
      selectedShellProfile("powershell", [
        { id: "git-bash", available: false },
        { id: "powershell", available: true },
      ]),
    ).toBe("powershell");
    expect(normalizeScrollbackLimit(50)).toBe(100);
    expect(normalizeScrollbackLimit(60000)).toBe(50000);
    expect(normalizeScrollbackLimit("bad")).toBe(1000);
    expect(normalizeSmoothScrollDuration(-5)).toBe(0);
    expect(normalizeSmoothScrollDuration(99999)).toBe(1000);
  });

  test("resolves the effective preview theme", () => {
    expect(resolvePreviewTheme("light", true)).toBe("light");
    expect(resolvePreviewTheme("dark", false)).toBe("dark");
    expect(resolvePreviewTheme("system", true)).toBe("dark");
    expect(resolvePreviewTheme("system", false)).toBe("light");
  });

  test("defaults the WebGL renderer off only on Windows", () => {
    expect(
      defaultWebglRenderer("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"),
    ).toBe(true);
    expect(
      defaultWebglRenderer("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
    ).toBe(false);
  });
});

describe("appearance cookie", () => {
  test("round-trips and normalizes partial writes", () => {
    saveAppearanceCookie({ chatFontSize: "large", terminalFontSize: "xlarge" });
    expect(loadAppearanceCookie()).toEqual({
      chatFontSize: "large",
      previewFontSize: "normal",
      previewTheme: "system",
      terminalFontSize: "xlarge",
      terminalThemeMode: "system",
      terminalDefaultProfile: "default",
      terminalScrollbackLimit: 1000,
      terminalSmoothScrollDuration: 0,
      terminalWebglRenderer: undefined,
      terminalThemeModeMigrated: false,
    });

    saveAppearanceCookie({ previewFontSize: "small", previewTheme: "light" });
    expect(loadAppearanceCookie()).toEqual({
      chatFontSize: "large",
      previewFontSize: "small",
      previewTheme: "light",
      terminalFontSize: "xlarge",
      terminalThemeMode: "system",
      terminalDefaultProfile: "default",
      terminalScrollbackLimit: 1000,
      terminalSmoothScrollDuration: 0,
      terminalWebglRenderer: undefined,
      terminalThemeModeMigrated: false,
    });
  });

  test("recovers from corrupt cookie data", () => {
    document.cookie = `${COOKIE_KEY}=%%%not-json; Path=/`;
    expect(loadAppearanceCookie()).toEqual({
      chatFontSize: "normal",
      previewFontSize: "normal",
      previewTheme: "system",
      terminalFontSize: "normal",
      terminalThemeMode: "system",
      terminalDefaultProfile: "default",
      terminalScrollbackLimit: 1000,
      terminalSmoothScrollDuration: 0,
      terminalWebglRenderer: undefined,
      terminalThemeModeMigrated: false,
    });
  });

  test("resets a frozen dark terminal theme once", () => {
    saveAppearanceCookie({ terminalThemeMode: "dark" });
    expect(migrateTerminalThemeCookie()).toBe(true);
    expect(loadAppearanceCookie().terminalThemeMode).toBe("system");
    saveAppearanceCookie({ terminalThemeMode: "dark" });
    expect(migrateTerminalThemeCookie()).toBe(false);
    expect(loadAppearanceCookie().terminalThemeMode).toBe("dark");
  });

  test("keeps terminalWebglRenderer only for boolean values", () => {
    saveAppearanceCookie({ terminalWebglRenderer: false });
    expect(loadAppearanceCookie().terminalWebglRenderer).toBe(false);
    saveAppearanceCookie({ terminalWebglRenderer: true });
    expect(loadAppearanceCookie().terminalWebglRenderer).toBe(true);
    saveAppearanceCookie({ terminalWebglRenderer: "yes" });
    expect(loadAppearanceCookie().terminalWebglRenderer).toBeUndefined();
  });
});

describe("applyAppearanceToDom", () => {
  test("sets font variables and the resolved preview theme attribute", () => {
    applyAppearanceToDom({
      chatFontSize: "large",
      previewFontSize: "medium",
      previewTheme: "dark",
      themeIsDark: false,
    });
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--preview-font-size")).toBe("15px");
    expect(document.documentElement.getAttribute("data-preview-theme")).toBe("dark");
  });

  test("removes the forced theme attribute in system mode", () => {
    document.documentElement.setAttribute("data-preview-theme", "light");
    applyAppearanceToDom({
      chatFontSize: "normal",
      previewFontSize: "normal",
      previewTheme: "system",
      themeIsDark: true,
    });
    expect(document.documentElement.getAttribute("data-preview-theme")).toBeNull();
  });
});
