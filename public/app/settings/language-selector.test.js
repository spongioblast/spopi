// ABOUTME: Tests settings language selector.
// ABOUTME: Includes "renders all language choices from i18n".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { mountLanguageSelector } from "./language-selector.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));
const zhMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/zh.json"), "utf8"));

function clearLanguageCookie() {
  document.cookie = "spopi-language=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}

beforeEach(async () => {
  clearLanguageCookie();
  document.body.innerHTML = `
    <select id="settings-language-select"></select>
    <span id="language-label" data-i18n="settings.language.title">Language</span>
  `;
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("/locales/en.json")) return new Response(JSON.stringify(enMessages));
    if (url.includes("/locales/zh.json")) return new Response(JSON.stringify(zhMessages));
    return new Response(JSON.stringify({}), { status: 404 });
  });
  await createI18n();
});

afterEach(() => {
  clearLanguageCookie();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings language selector", () => {
  it("renders all language choices from i18n", () => {
    mountLanguageSelector(document);

    const options = Array.from(document.querySelectorAll("#settings-language-select option"));
    // The supported locales may grow; ensure the core ones are present.
    const values = options.map((option) => option.value);
    const texts = options.map((option) => option.textContent);
    expect(values).toContain("system");
    expect(values).toContain("en");
    expect(values).toContain("zh");
    expect(values).toContain("de");
    expect(values).toContain("it");
    // Verify the core language display names are present.
    expect(texts).toContain("System Default");
    expect(texts).toContain("English");
    expect(texts).toContain("中文");
    expect(texts).toContain("Deutsch");
    expect(texts).toContain("Italiano");
  });

  it("switches locale and repaints translated DOM", async () => {
    mountLanguageSelector(document);

    const select = document.getElementById("settings-language-select");
    select.value = "zh";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));

    expect(document.getElementById("language-label").textContent).toBe("语言");
    expect(select.value).toBe("zh");
  });
});
