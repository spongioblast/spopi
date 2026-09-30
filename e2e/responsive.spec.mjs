// ABOUTME: Pairs a phone-sized browser with the desktop and checks the shell.
// ABOUTME: The host ports come from SPOPI_E2E_LOOPBACK and SPOPI_E2E_PHONE.

import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const loopback = process.env.SPOPI_E2E_LOOPBACK;
const phone = process.env.SPOPI_E2E_PHONE;
const certPath = process.env.SPOPI_E2E_CERT;
assert.ok(loopback && phone && certPath, "e2e ports are missing");

const certificate = new X509Certificate(readFileSync(certPath));
const spki = createHash("sha256")
  .update(certificate.publicKey.export({ type: "spki", format: "der" }))
  .digest("base64");
const browser = await chromium.launch({
  channel: "chrome",
  args: [`--ignore-certificate-errors-spki-list=${spki}`],
});
const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktop = await desktopContext.newPage();
const phoneContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  ignoreHTTPSErrors: true,
});
const phonePage = await phoneContext.newPage();

async function noOverflow(page, label) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  assert.equal(fits, true, `${label} overflows`);
}

async function axeClean(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  assert.equal(
    serious.length,
    0,
    `${label} axe: ${serious
      .map((item) => {
        const targets = item.nodes
          .slice(0, 4)
          .map((node) => node.target.join(" "))
          .join(" || ");
        return `${item.id} [${targets}]`;
      })
      .join(" | ")}`,
  );
}

try {
  const codeMirrorRequests = [];
  for (const page of [desktop, phonePage]) {
    page.on("request", (request) => {
      if (request.url().includes("vendor/codemirror")) codeMirrorRequests.push(request.url());
    });
  }
  await desktop.goto(`http://127.0.0.1:${loopback}/app`, { waitUntil: "domcontentloaded" });
  await desktop.locator("html[data-host-connected='1']").waitFor({ timeout: 20000 });
  await phonePage.goto(`https://127.0.0.1:${phone}/pair`, { waitUntil: "domcontentloaded" });
  await phonePage.locator("input").fill("Pixel");
  await phonePage.locator("button").click();
  await phonePage.waitForFunction(
    () => /^\d+ /.test(document.querySelector("#pair-status")?.textContent || ""),
    null,
    { timeout: 10000 },
  );
  const claimStatus = await phonePage.locator("#pair-status").textContent();
  assert.match(claimStatus || "", /^200 /, `claim failed: ${claimStatus}`);
  const tier = desktop.locator(".approval-tier");
  await tier.waitFor({ timeout: 20000 });
  await tier.selectOption("control");
  await desktop.locator(".approval-choice").first().click();
  await phonePage.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 20000 });
  await phonePage.goto(
    `https://127.0.0.1:${phone}/app/workspaces/workspace-a/sessions/temporary-e2e`,
    { waitUntil: "domcontentloaded" },
  );
  await phonePage.locator("html[data-host-connected='1']").waitFor({ timeout: 20000 });
  for (const region of ["chat", "changes", "more"]) {
    await phonePage.locator(`.phone-tabs [data-phone-region="${region}"]`).click();
  }
  await phonePage.locator('.phone-tabs [data-phone-region="chat"]').click();
  const phoneChat = await phonePage.evaluate(() => {
    const main = document.querySelector(".workspace-content > .main");
    return (main?.getBoundingClientRect().width || 0) / window.innerWidth;
  });
  assert.ok(phoneChat >= 0.9, `phone chat main width ratio ${phoneChat}`);
  await phonePage.locator('.phone-tabs [data-phone-region="changes"]').click();
  const phoneChanges = await phonePage.evaluate(() => {
    const review = document.getElementById("spopi-review");
    if (!review) return { display: "missing", ratio: 0 };
    return {
      display: getComputedStyle(review).display,
      ratio: review.getBoundingClientRect().width / window.innerWidth,
    };
  });
  assert.notEqual(phoneChanges.display, "none", "phone changes review is hidden");
  assert.ok(phoneChanges.ratio >= 0.9, `phone changes width ratio ${phoneChanges.ratio}`);
  await noOverflow(phonePage, "phone");
  await axeClean(phonePage, "phone");
  await axeClean(desktop, "desktop");
  for (const width of [820, 1440]) {
    await desktop.setViewportSize({ width, height: 900 });
    if (width === 820) {
      await desktop.goto(
        `http://127.0.0.1:${loopback}/app/workspaces/workspace-a/sessions/temporary-e2e`,
        { waitUntil: "domcontentloaded" },
      );
      const files = desktop.locator(".spopi-rail [data-nav='files']");
      await files.click();
      await desktop.locator(".shell-scrim").waitFor({ timeout: 10000 });
      await desktop.keyboard.press("Escape");
      await desktop.locator(".shell-scrim").waitFor({ state: "hidden", timeout: 5000 });
      const focused = await desktop.evaluate(() =>
        document.activeElement?.getAttribute("data-nav"),
      );
      assert.equal(focused, "files");
      const narrowFill = await desktop.evaluate(() => {
        const main = document.querySelector(".workspace-content > .main");
        return (main?.getBoundingClientRect().width || 0) / window.innerWidth;
      });
      assert.ok(narrowFill >= 0.85, `narrow main width ratio ${narrowFill}`);
    }
    await noOverflow(desktop, String(width));
  }
  const devices = await desktop.evaluate(async () => {
    const response = await fetch("/api/phone/devices");
    return response.json();
  });
  const id = devices.devices?.[0]?.id;
  assert.ok(id, "paired device is missing");
  await desktop.evaluate(async (deviceId) => {
    await fetch("/api/phone/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: deviceId }),
    });
  }, id);
  const revoked = await phonePage.goto(`https://127.0.0.1:${phone}/`, { waitUntil: "commit" });
  assert.equal(revoked?.status(), 401);
  assert.deepEqual(codeMirrorRequests, [], "CodeMirror loaded before a code file opened");
  await desktop.setViewportSize({ width: 1300, height: 860 });
  await desktop.goto(
    `http://127.0.0.1:${loopback}/app/workspaces/workspace-a/sessions/temporary-e2e`,
    { waitUntil: "domcontentloaded" },
  );
  await desktop.locator("html[data-host-connected='1']").waitFor({ timeout: 20000 });
  await desktop.locator(".spopi-rail [data-nav='files']").click();
  await desktop.locator('.file-tree-row[data-kind="file"]').first().click();
  await desktop.locator("#file-preview-panel:not(.collapsed)").waitFor({ timeout: 10000 });
  const preview = await desktop.evaluate(() => {
    const panel = document.getElementById("file-preview-panel");
    const main = document.querySelector(".workspace-content > .main");
    return {
      position: panel ? getComputedStyle(panel).position : "missing",
      chat: main?.getBoundingClientRect().width || 0,
    };
  });
  assert.notEqual(preview.position, "fixed", `preview position ${preview.position}`);
  assert.ok(preview.chat >= 380, `chat width ${preview.chat}`);
  console.log("e2e responsive pairing passed");
} finally {
  await browser.close();
}
