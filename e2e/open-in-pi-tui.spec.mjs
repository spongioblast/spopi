// ABOUTME: Clicks the header π button against the e2e host and waits for the Pi TUI in the dock.
// ABOUTME: The chat stays where it is; Pi runs on a new session in a tab named "Pi".

import assert from "node:assert/strict";
import { chromium } from "playwright";

const loopback = process.env.SPOPI_E2E_LOOPBACK;
assert.ok(loopback, "e2e port is missing");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(
    `http://127.0.0.1:${loopback}/app/workspaces/workspace-a/sessions/temporary-e2e`,
    { waitUntil: "domcontentloaded" },
  );
  await page.locator("html[data-host-connected='1']").waitFor({ timeout: 20000 });
  await page.locator("#status-text", { hasText: "Connected" }).waitFor({ timeout: 60000 });
  const before = page.url();
  await page.locator("#open-in-terminal-btn").click();
  const result = await page
    .waitForFunction(() => globalThis.__spopiOpenInTerminalLast?.result, null, { timeout: 60000 })
    .then((handle) => handle.jsonValue());
  assert.equal(result.wrote, true);
  assert.doesNotMatch(result.command, /--session|--fork/);
  assert.equal(page.url(), before, "the chat moved");

  const started = Date.now();
  let text = "";
  while (Date.now() - started < 60000) {
    text = await page.evaluate(
      () => [...document.querySelectorAll(".xterm-rows")].at(-1)?.textContent ?? "",
    );
    if (/\d\.\d%\//.test(text)) break;
    await page.waitForTimeout(500);
  }
  if (process.env.SPOPI_E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.SPOPI_E2E_SHOTS}/open-in-pi-tui.png` });
  }
  assert.match(text, /\d\.\d%\//, `the Pi TUI never drew its footer:\n${text}`);
  const tabName = await page.locator(".terminal-tab.active .terminal-tab-label").innerText();
  assert.equal(tabName, "Pi");
  console.log("e2e open in pi tui passed");
} finally {
  await browser.close();
}
