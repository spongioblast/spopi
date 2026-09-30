#!/usr/bin/env node
// ABOUTME: Playwright screenshot helper against the running HostServer UI.
// ABOUTME: Saves PNGs under the workspace verification folder, not this repo.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireScratchHost } from "./scratch-host.mjs";

const verifyRoot = process.env.SPOPI_VERIFY_ROOT;
if (!verifyRoot || !process.env.SPOPI_E2E_REPO || !process.env.SPOPI_E2E_NONREPO) {
  console.error(
    "Set SPOPI_VERIFY_ROOT, SPOPI_E2E_REPO, and SPOPI_E2E_NONREPO. This script drives a live host; start that host with SPOPI_APP_DATA_DIR.",
  );
  process.exit(1);
}
const port = process.env.SPOPI_HOST_PORT || "57620";
const origin = `http://127.0.0.1:${port}`;
const name = process.argv[2] || "shot";
const viewportArg = process.argv.includes("--viewport")
  ? process.argv[process.argv.indexOf("--viewport") + 1]
  : "1024x700,1920x1080";
const viewports = viewportArg.split(",").map((pair) => {
  const [width, height] = pair.split("x").map(Number);
  return { width, height };
});
const phase = process.env.SPOPI_E2E_PHASE || "phase0";

async function waitForHealth(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Host not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const playwright = await import("playwright").catch(() => null);
if (!playwright) {
  console.error(
    "playwright is not installed; run bun add -d playwright && bunx playwright install chromium",
  );
  process.exit(2);
}

await waitForHealth(`${origin}/health`);
await requireScratchHost(origin);
await waitForHealth(`${origin}/health/runtime`);

const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const geometry = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./assert.mjs", import.meta.url))],
  {
    stdio: "inherit",
    env: process.env,
  },
);
if (geometry.status !== 0) process.exit(geometry.status ?? 1);

const browser = await playwright.chromium.launch();
const outDir = join(verifyRoot, phase);
mkdirSync(outDir, { recursive: true });

for (const { width, height } of viewports) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.context().addCookies([{ name: "spopi-theme", value: "dawn", url: origin }]);
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  if (!(await page.locator(".spopi-shell").count())) {
    await page.waitForSelector(".session-item", { timeout: 20_000 });
    await page.evaluate(() => {
      document.querySelector(".project-group-header.collapsed")?.click();
      document.querySelector(".session-item")?.click();
    });
    await page.waitForSelector(".spopi-shell", { timeout: 25_000 });
  }
  await page.waitForFunction(() => document.querySelector(".spopi-shell"), { timeout: 15_000 });
  // A shot taken while the session is still loading shows the welcome card
  // over the history and a fading composer. Wait for Connected, then settle.
  await page
    .waitForFunction(
      () => /^connected$/i.test((document.getElementById("status-text")?.textContent || "").trim()),
      undefined,
      { timeout: 60_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  const dest = join(outDir, `${name}-${width}.png`);
  await page.screenshot({ path: dest, fullPage: false });
  console.log(dest);
  await page.close();
}

await browser.close();
