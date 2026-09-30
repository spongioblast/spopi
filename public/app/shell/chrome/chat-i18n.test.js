// ABOUTME: Tests translated welcome copy in the chat region.
// ABOUTME: i18n is ready before the welcome text is shown.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createI18n, translateSubtree } from "../../i18n/i18n.js";
import { mountChatChrome } from "./chat.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test("chat welcome is translated once i18n is ready", async () => {
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/en.json")) {
      return new Response(JSON.stringify(enMessages));
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
  await createI18n();
  const workspace = document.createElement("div");
  const main = document.createElement("div");
  document.body.append(workspace, main);
  mountChatChrome(workspace, main);
  translateSubtree(document.body);
  const welcome = document.querySelector("#messages .welcome");
  expect(welcome?.textContent).toContain("Welcome to SPOPI");
  expect(welcome?.textContent).not.toContain("app.welcome");
});
