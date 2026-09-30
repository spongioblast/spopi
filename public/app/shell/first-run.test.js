// ABOUTME: Tests the first-launch setup note.
// ABOUTME: first-run.js shows once, then stays dismissed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { FIRST_RUN_DISMISSED_KEY, maybeShowFirstRun } from "./first-run.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

/** @param {unknown} [stored] */
function preferences(stored = null) {
  return {
    get: vi.fn(async () => stored),
    set: vi.fn(async () => true),
  };
}

describe("first-run note", () => {
  /** @type {HTMLElement} */
  let container;

  beforeEach(async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("/locales/en.json")) {
        return new Response(JSON.stringify(enMessages));
      }
      return new Response("{}", { status: 404 });
    });
    await createI18n();
    container = document.createElement("div");
    container.id = "dialog-container";
    container.className = "hidden";
    document.body.append(container);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("stays hidden after it was dismissed", async () => {
    const prefs = preferences(true);
    const shown = await maybeShowFirstRun({ preferences: prefs, container });
    expect(shown).toBe(false);
    expect(container.querySelector(".dialog")).toBeNull();
    expect(prefs.set).not.toHaveBeenCalled();
  });

  it("stays hidden when the preference cannot be read", async () => {
    const prefs = preferences();
    prefs.get.mockRejectedValue(new Error("offline"));
    const shown = await maybeShowFirstRun({
      preferences: prefs,
      container,
      sleep: async () => {},
    });
    expect(shown).toBe(false);
    expect(prefs.get).toHaveBeenCalledTimes(10);
    expect(prefs.set).not.toHaveBeenCalled();
  });

  it("retries a failed preference read and then shows the note", async () => {
    const prefs = preferences(null);
    prefs.get
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    const shown = await maybeShowFirstRun({
      preferences: prefs,
      container,
      sleep: async () => {},
    });
    expect(shown).toBe(true);
    expect(prefs.get).toHaveBeenCalledTimes(3);
  });

  it("a Settings button keeps the note, which comes back when Settings closes", async () => {
    const prefs = preferences(null);
    const openSettings = vi.fn();
    const shown = await maybeShowFirstRun({ preferences: prefs, openSettings, container });
    expect(shown).toBe(true);
    expect(container.querySelector(".dialog-actions .ui-button--primary")?.textContent).toBe(
      "Got it",
    );
    expect(container.textContent).toContain("Before you start");
    expect(container.textContent).toContain("SPOPI in your home directory");

    container.querySelector("[data-first-run='projects']")?.dispatchEvent(new MouseEvent("click"));
    expect(openSettings).toHaveBeenCalledWith("general");
    expect(prefs.set).not.toHaveBeenCalled();
    expect(container.querySelector(".dialog")).toBeNull();

    document.dispatchEvent(new CustomEvent("spopi-settings-closed"));
    await vi.waitFor(() => expect(container.querySelector(".first-run-dialog")).not.toBeNull());
    container
      .querySelector(".dialog-actions .ui-button--primary")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(prefs.set).toHaveBeenCalledWith(FIRST_RUN_DISMISSED_KEY, true);

    const again = await maybeShowFirstRun({
      preferences: preferences(true),
      openSettings,
      container,
    });
    expect(again).toBe(false);
  });

  it("shows again on request even after it was dismissed", async () => {
    const shown = await maybeShowFirstRun({
      preferences: preferences(true),
      container,
      force: true,
    });
    expect(shown).toBe(true);
    expect(container.querySelector(".first-run-dialog")).not.toBeNull();
    const second = await maybeShowFirstRun({
      preferences: preferences(true),
      container,
      force: true,
    });
    expect(second).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it("opens models and records a dismissal from Got it or Escape", async () => {
    const prefs = preferences(null);
    const openSettings = vi.fn();
    await maybeShowFirstRun({ preferences: prefs, openSettings, container });
    container.querySelector("[data-first-run='model']")?.dispatchEvent(new MouseEvent("click"));
    expect(openSettings).toHaveBeenCalledWith("models");
    expect(prefs.set).not.toHaveBeenCalled();

    const escapePrefs = preferences(null);
    await maybeShowFirstRun({ preferences: escapePrefs, container });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(escapePrefs.set).toHaveBeenCalledWith(FIRST_RUN_DISMISSED_KEY, true);
    expect(container.classList.contains("hidden")).toBe(true);
  });

  it("marks npm as required and opens Dependencies", async () => {
    const openSettings = vi.fn();
    const control = {
      checkDependencies: vi.fn(async () => ({
        npm: { state: "missing" },
        browser: { state: "ok" },
      })),
    };
    await maybeShowFirstRun({
      preferences: preferences(null),
      control,
      openSettings,
      container,
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Required: npm (Node.js)");
    });
    container
      .querySelector("[data-first-run='dependencies']")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(openSettings).toHaveBeenCalledWith("dependencies");
  });

  it("shows npm and a missing browser together", async () => {
    const control = {
      checkDependencies: vi.fn(async () => ({
        npm: { state: "missing" },
        browser: { state: "missing" },
      })),
    };
    await maybeShowFirstRun({
      preferences: preferences(null),
      control,
      container,
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Required: npm (Node.js)");
      expect(container.textContent).toContain("needs Chrome");
    });
  });

  it("says the tools are ready when npm and the browser work", async () => {
    const control = {
      checkDependencies: vi.fn(async () => ({ npm: { state: "ok" }, browser: { state: "ok" } })),
    };
    await maybeShowFirstRun({
      preferences: preferences(null),
      control,
      container,
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("npm and the browser are ready.");
    });
    const dependencies = /** @type {HTMLButtonElement | null} */ (
      container.querySelector("[data-first-run='dependencies']")
    );
    expect(dependencies?.hidden).toBe(false);
  });

  it("points to the recommended packages and opens the Packages page", async () => {
    const openSettings = vi.fn();
    await maybeShowFirstRun({ preferences: preferences(null), openSettings, container });
    expect(container.textContent).toContain("Recommended packages");
    expect(container.textContent).toContain("Settings → Packages → Recommended");
    container.querySelector("[data-first-run='packages']")?.dispatchEvent(new MouseEvent("click"));
    expect(openSettings).toHaveBeenCalledWith("extensions");
  });
});
