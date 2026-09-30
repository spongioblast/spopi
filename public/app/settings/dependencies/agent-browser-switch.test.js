// ABOUTME: Tests the agent-browser switch default and its restart note.
// ABOUTME: An unset preference stays on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/i18n.js";
import { agentBrowserSwitch } from "./agent-browser-switch.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/en.json")) {
      return new Response(JSON.stringify(enMessages));
    }
    return new Response("{}", { status: 404 });
  });
  await createI18n();
  document.body.replaceChildren();
});

describe("agent-browser switch", () => {
  it("reads an unset preference as on and shows Restart now after a change", async () => {
    const preferences = { get: vi.fn(async () => undefined), set: vi.fn(async () => true) };
    const row = agentBrowserSwitch({ preferences, relaunch: async () => {} });
    document.body.append(row);
    const toggle = /** @type {HTMLButtonElement} */ (row.querySelector("#toggle-agent-browser"));
    await vi.waitFor(() => expect(preferences.get).toHaveBeenCalled());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.dispatchEvent(new MouseEvent("click"));
    expect(preferences.set).toHaveBeenCalledWith("ui.agentBrowser.enabled", false);
    expect(row.textContent).toContain("Restart now");
  });
});
