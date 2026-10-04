// ABOUTME: Opens Settings → MCP against the e2e host and the echo fixture.
// ABOUTME: The host's PI_CODING_AGENT_DIR already contains that server.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const loopback = process.env.SPOPI_E2E_LOOPBACK;
assert.ok(loopback, "e2e port is missing");

/**
 * The newest dock terminal's rows once they match `pattern`.
 * @param {import("playwright").Page} page
 * @param {RegExp} pattern
 * @param {number} timeoutMs
 */
async function waitForTerminalText(page, pattern, timeoutMs) {
  const started = Date.now();
  let text = "";
  while (Date.now() - started < timeoutMs) {
    text = await page.evaluate(
      () => [...document.querySelectorAll(".xterm-rows")].at(-1)?.textContent ?? "",
    );
    if (pattern.test(text) && /MCP/i.test(text)) return text;
    await page.waitForTimeout(500);
  }
  const state = await page.evaluate(() => ({
    xterms: document.querySelectorAll(".xterm").length,
    rows: document.querySelectorAll(".xterm-rows").length,
    notices: [...document.querySelectorAll(".notification")].map((n) => n.textContent),
  }));
  if (process.env.SPOPI_E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.SPOPI_E2E_SHOTS}/mcp-manage-failed.png` });
  }
  throw new Error(`terminal never showed Pi's MCP manager: ${JSON.stringify(state)}\n${text}`);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(
    `http://127.0.0.1:${loopback}/app/workspaces/workspace-a/sessions/temporary-e2e`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.locator("html[data-host-connected='1']").waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("spopi-open-settings", { detail: { tab: "mcp" } }));
  });
  const row = page.locator("[data-server='echo']");
  await row.waitFor({ timeout: 90000 });
  const text = await row.innerText();
  assert.match(text, /3/);
  assert.equal(await row.locator(".mcp-dot--ok").count(), 1);
  await page.setViewportSize({ width: 1024, height: 800 });
  await row.waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });

  const firstRun = page.locator("#dialog-container .dialog-actions .ui-button--primary");
  if (await firstRun.count()) await firstRun.click();
  await page.evaluate(() => {
    globalThis.__mcpReloads = 0;
    document.addEventListener("spopi-pi-config-changed", () => {
      globalThis.__mcpReloads += 1;
    });
  });
  await page.locator(".mcp-header-actions .ui-button--secondary").click();
  const screen = await waitForTerminalText(page, /echo/, 60000);
  assert.match(screen, /MCP servers.*echo\s+connected/s);
  if (process.env.SPOPI_E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.SPOPI_E2E_SHOTS}/mcp-manage-in-pi.png` });
  }

  const tabs = () => page.locator(".xterm").count();
  const opened = await tabs();
  await page.locator(".xterm").last().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+D");
  const started = Date.now();
  while ((await tabs()) >= opened) {
    if (Date.now() - started > 20000) throw new Error("the manager tab stayed open after Pi quit");
    await page.waitForTimeout(250);
  }
  assert.equal(await page.evaluate(() => globalThis.__mcpReloads), 1);
  console.log("e2e mcp settings passed");
} finally {
  await browser.close();
}
