// ABOUTME: Tests mountAppearanceSettings.
// ABOUTME: A font change round-trips through the cookie and the preference DB.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../i18n/i18n.js", () => ({
  t: (key) => key,
  onLocaleChange: () => () => {},
  translateSubtree: () => {},
}));

import { loadAppearanceCookie, saveAppearanceCookie } from "./appearance-preferences.js";
import { mountAppearanceSettings } from "./appearance-settings.js";

function fakePreferences(db = {}) {
  return {
    get: vi.fn(async (key) => (key in db ? db[key] : null)),
    set: vi.fn(async () => {}),
  };
}

function mount(deps) {
  const root = document.createElement("div");
  document.body.append(root);
  return mountAppearanceSettings(root, deps);
}

function clearAppearanceState() {
  document.cookie = "spopi-appearance=; Max-Age=0; Path=/";
  document.documentElement.removeAttribute("data-preview-theme");
  document.documentElement.style.removeProperty("--chat-font-size");
  document.documentElement.style.removeProperty("--preview-font-size");
}

beforeEach(() => {
  clearAppearanceState();
});

afterEach(() => {
  for (const node of document.querySelectorAll(".ui-select-popover")) node.remove();
  document.body.innerHTML = "";
  clearAppearanceState();
});

describe("mountAppearanceSettings", () => {
  test("renders cookie state into the segmented controls on setup", () => {
    saveAppearanceCookie({ chatFontSize: "large", previewTheme: "light" });
    mount({ preferences: fakePreferences() });

    expect(document.querySelector('#settings-chat-font-size [data-level="large"]').checked).toBe(
      true,
    );
    expect(document.getElementById("settings-chat-font-size-name").textContent).toBe(
      "settings.fontLevel.large",
    );
    expect(document.documentElement.getAttribute("data-preview-theme")).toBe("light");
    const previewOptions = [
      ...document.querySelectorAll("#settings-preview-theme-select option"),
    ].map((option) => option.value);
    expect(previewOptions).toEqual(["system", "light", "dark"]);
    expect(document.getElementById("settings-preview-theme-select").value).toBe("light");
  });

  test("clicking a font dot updates cookie, DOM, DB, and live surfaces", async () => {
    const preferences = fakePreferences();
    mount({ preferences });

    document.querySelector('#settings-chat-font-size [data-level="medium"]').click();
    await Promise.resolve();

    expect(loadAppearanceCookie().chatFontSize).toBe("medium");
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("14px");
    expect(preferences.set).toHaveBeenCalledWith("ui.chatFontSize", "medium");
  });

  test("preview theme select persists and applies", async () => {
    const preferences = fakePreferences();
    mount({ preferences });

    const previewSelect = document.getElementById("settings-preview-theme-select");
    previewSelect.value = "dark";
    previewSelect.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(document.documentElement.getAttribute("data-preview-theme")).toBe("dark");
    expect(preferences.set).toHaveBeenCalledWith("ui.previewTheme", "dark");
  });

  test("reconcile prefers DB values and seeds missing keys from the cookie", async () => {
    saveAppearanceCookie({ chatFontSize: "large" });
    const preferences = fakePreferences({ "ui.chatFontSize": "xlarge" });
    const controls = mount({ preferences });

    await controls.refresh();

    // DB value wins over the cookie.
    expect(loadAppearanceCookie().chatFontSize).toBe("xlarge");
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("18px");
    // Cookie-only values are seeded into the DB exactly once.
    expect(preferences.set).toHaveBeenCalledWith("ui.previewTheme", "system");
    expect(preferences.set).not.toHaveBeenCalledWith("ui.chatFontSize", expect.anything());
  });

  test("a preference gateway failure degrades to cookie-only operation", async () => {
    saveAppearanceCookie({ chatFontSize: "medium" });
    const preferences = {
      get: vi.fn(async () => {
        throw new Error("host down");
      }),
      set: vi.fn(async () => {
        throw new Error("host down");
      }),
    };
    const controls = mount({ preferences });

    await expect(controls.refresh()).resolves.toBeUndefined();
    expect(preferences.set).not.toHaveBeenCalled();

    document.querySelector('#settings-chat-font-size [data-level="small"]').click();
    await Promise.resolve();
    // Local application still happens despite the persistence failure.
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("12px");
  });

  test("does not let a DB read overwrite a newer local setting", async () => {
    saveAppearanceCookie({ chatFontSize: "medium" });
    let resolveRead;
    const read = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const preferences = {
      get: vi.fn(async (key) => {
        if (key === "ui.chatFontSize") {
          await read;
          return "xlarge";
        }
        return null;
      }),
      set: vi.fn(async () => {}),
    };
    const controls = mount({ preferences });
    const reconciliation = controls.refresh();

    document.querySelector('#settings-chat-font-size [data-level="small"]').click();
    resolveRead();
    await reconciliation;

    expect(loadAppearanceCookie().chatFontSize).toBe("small");
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("12px");
  });
});
