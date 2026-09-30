// ABOUTME: Tests the Packages notice shown when npm is not working.
// ABOUTME: A working npm check leaves the host unchanged.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { mountNpmNotice } from "./npm-notice.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/en.json")) {
      return new Response(JSON.stringify(enMessages));
    }
    return new Response("{}", { status: 404 });
  });
  await createI18n();
});

describe("npm notice", () => {
  it("shows Open Dependencies when npm is missing and stays quiet when it works", () => {
    const host = document.createElement("div");
    const openSettings = vi.fn();
    mountNpmNotice(host, { report: { npm: { state: "missing" } }, openSettings });
    expect(host.textContent).toContain("npm is not working");
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click"));
    expect(openSettings).toHaveBeenCalledWith("dependencies");
    mountNpmNotice(host, { report: { npm: { state: "ok" } }, openSettings });
    expect(host.querySelector("[data-npm-notice]")).toBeNull();
  });
});
