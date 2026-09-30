// ABOUTME: Tests the Surf card's extension ID check and connect call.
// ABOUTME: The installed switch writes Pi's package disable flag.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/i18n.js";
import { surfCard } from "./surf-card.js";

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

const browsers = [
  { id: "chrome", name: "Google Chrome" },
  { id: "edge", name: "Microsoft Edge" },
];

describe("surf card", () => {
  it("rejects a short extension id and connects with the selected browser", async () => {
    const control = {
      surfConnect: vi.fn(async () => ({ ok: false, lines: ["denied"] })),
      openBrowserExtensions: vi.fn(async () => true),
      surfExtensionPath: vi.fn(async () => ""),
    };
    const card = surfCard({
      report: { state: "not_installed", installed: false, browsers },
      npmOk: true,
      control,
    });
    document.body.append(card);
    [...card.querySelectorAll("button")]
      .find((node) => node.textContent === "Set up Surf")
      ?.dispatchEvent(new MouseEvent("click"));
    const input = /** @type {HTMLInputElement} */ (card.querySelector("input"));
    input.value = "abc";
    [...card.querySelectorAll("button")]
      .find((node) => node.textContent === "Connect")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(control.surfConnect).not.toHaveBeenCalled();
    expect(card.textContent).toContain("32 letters");
    input.value = "abcdefghijklmnopabcdefghijklmnop";
    const select = /** @type {HTMLSelectElement} */ (card.querySelector("select"));
    select.value = "edge";
    [...card.querySelectorAll("button")]
      .find((node) => node.textContent === "Connect")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(control.surfConnect).toHaveBeenCalledWith("abcdefghijklmnopabcdefghijklmnop", "edge");
  });

  it("turns the installed package off through Pi", async () => {
    const configGateway = {
      call: vi.fn(async () => ({ ok: true, data: { changed: true, reloaded: false } })),
    };
    const card = surfCard({
      report: { state: "ok", installed: true, enabled: true, browsers },
      npmOk: true,
      configGateway,
      relaunch: async () => {},
    });
    document.body.append(card);
    card.querySelector("#toggle-surf")?.dispatchEvent(new MouseEvent("click"));
    await vi.waitFor(() => {
      expect(configGateway.call).toHaveBeenCalledWith("set_package_enabled", {
        source: "npm:surf-cli",
        scope: "global",
        enabled: false,
      });
    });
    expect(card.textContent).not.toContain("Install the Surf package.");
    expect(card.textContent).toContain("Connect again");
  });
});
