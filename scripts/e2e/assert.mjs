#!/usr/bin/env node
// ABOUTME: DOM measurement helper for E2E acceptance (boxes, computed styles).
// ABOUTME: Geometry mode fails a half-height workbench before any screenshot is kept.

const port = process.env.SPOPI_HOST_PORT || "57620";
const origin = `http://127.0.0.1:${port}`;
const mode = process.argv[2];
const property = process.argv[3];

const playwright = await import("playwright").catch(() => null);
if (!playwright) {
  console.error("playwright is not installed");
  process.exit(2);
}

async function openSessionShell(page) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  if (await page.locator(".spopi-shell").count()) return;
  await page.waitForSelector(".session-item", { timeout: 20_000 });
  await page.evaluate(() => {
    document.querySelector(".project-group-header.collapsed")?.click();
    document.querySelector(".session-item")?.click();
  });
  await page.waitForSelector(".spopi-shell", { timeout: 25_000 });
}

async function withPage(viewport, run) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport });
  await openSessionShell(page);
  const result = await run(page);
  await browser.close();
  return result;
}

async function assertGeometry(width, height) {
  const failures = await withPage({ width, height }, async (page) => {
    const dockTab = await page.evaluate(
      () => document.getElementById("spopi-dock")?.dataset.activeTab || "",
    );
    if (dockTab === "terminal") {
      try {
        await page.waitForSelector(".xterm", { timeout: 5000 });
      } catch {
        return ["missing .xterm within 5s of boot"];
      }
    }
    await page.evaluate(() => {
      document.querySelector('[data-dock="cockpit"]')?.click();
    });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const misses = [];
      const workspace = document.querySelector(".workspace-content");
      if (!workspace) return ["missing .workspace-content"];
      if (workspace.children.length !== 3) {
        misses.push(`workspace-content children ${workspace.children.length} !== 3`);
      }
      const rows = getComputedStyle(workspace).gridTemplateRows;
      if (rows.includes(" ") && !rows.startsWith("minmax") && rows.split(" ").length > 1) {
        const parts = rows.split(" ").filter((part) => part && part !== "none");
        if (parts.length > 1) misses.push(`grid-template-rows has ${parts.length} tracks: ${rows}`);
      }
      const pane = document.querySelector(".pane-center");
      if (pane && Math.abs(pane.getBoundingClientRect().height - window.innerHeight) > 8) {
        misses.push(
          `pane-center height ${Math.round(pane.getBoundingClientRect().height)} !== window ${window.innerHeight}`,
        );
      }
      const tabs = document.querySelector(".center-tabs, #file-preview-tabs, .file-preview-tabs");
      if (tabs && tabs.getBoundingClientRect().top < 36) {
        misses.push(`tab bar y ${Math.round(tabs.getBoundingClientRect().top)} < 36`);
      }
      const terminal = document.getElementById("terminal-panel");
      const dock = document.getElementById("spopi-dock");
      if (terminal && dock && !dock.contains(terminal)) {
        misses.push("#terminal-panel is not inside #spopi-dock");
      }
      const stack = document.getElementById("spopi-sidebar-stack");
      if (stack) {
        const stackWidth = stack.getBoundingClientRect().width;
        for (const child of stack.children) {
          const childWidth = child.getBoundingClientRect().width;
          if (childWidth > 0 && Math.abs(childWidth - stackWidth) > 2) {
            misses.push(
              `stack child ${child.id || child.className} width ${childWidth} !== ${stackWidth}`,
            );
          }
        }
      }
      const form = document.getElementById("chat-form");
      if (form && form.scrollWidth > form.clientWidth + 1) {
        misses.push(`#chat-form overflow ${form.scrollWidth} > ${form.clientWidth}`);
      }
      for (const button of document.querySelectorAll(".spopi-rail-btn")) {
        if (!button.getAttribute("aria-label")) misses.push("rail button missing aria-label");
      }
      const preview = document.getElementById("file-preview-panel");
      if (preview && pane && !preview.classList.contains("collapsed")) {
        const previewBox = preview.getBoundingClientRect();
        const paneBox = pane.getBoundingClientRect();
        if (Math.abs(previewBox.width - paneBox.width) > 2) {
          misses.push(
            `preview width ${Math.round(previewBox.width)} !== pane ${Math.round(paneBox.width)}`,
          );
        }
        if (Math.abs(previewBox.top - paneBox.top) > 2) {
          misses.push(
            `preview top ${Math.round(previewBox.top)} !== pane ${Math.round(paneBox.top)}`,
          );
        }
      }
      const main = document.querySelector(".workspace-content > .main");
      if (main) {
        const border = getComputedStyle(main).borderLeftWidth;
        if (border !== "1px") misses.push(`.main border-left-width ${border} !== 1px`);
      }
      if (dock && !dock.classList.contains("collapsed")) {
        const dockHeight = dock.getBoundingClientRect().height;
        if (dockHeight < 280) misses.push(`dock height ${Math.round(dockHeight)} < 280`);
      }
      const cockpitLog = document.querySelector(".metrics-overlay.docked .metrics-log");
      if (cockpitLog) {
        const logHeight = cockpitLog.getBoundingClientRect().height;
        if (logHeight < 60) misses.push(`cockpit log height ${Math.round(logHeight)} < 60`);
      }
      const extensionsSidebar = document.getElementById("extensions-sidebar");
      if (extensionsSidebar && getComputedStyle(extensionsSidebar).display !== "none") {
        misses.push("#extensions-sidebar is visible");
      }
      const terminalBody = document.querySelector("#spopi-dock .terminal-body");
      if (terminalBody) {
        const border = getComputedStyle(terminalBody).borderLeftWidth;
        if (border !== "0px") {
          misses.push(`.terminal-body border-left-width ${border} !== 0px`);
        }
      }
      const xterm = document.querySelector("#spopi-dock .terminal-body .xterm");
      const firstDockTab = document.querySelector("#spopi-dock .spopi-dock-tab");
      if (xterm && firstDockTab) {
        const xtermLeft = xterm.getBoundingClientRect().left;
        const tabPad = Number.parseFloat(getComputedStyle(firstDockTab).paddingLeft) || 0;
        const tabLeft = firstDockTab.getBoundingClientRect().left + tabPad;
        if (Math.abs(xtermLeft - tabLeft) > 2) {
          misses.push(
            `.xterm left ${Math.round(xtermLeft)} !== dock tab label ${Math.round(tabLeft)} ±2`,
          );
        }
      }
      return misses;
    });
  });
  if (failures.length) {
    console.error(`geometry ${width}x${height} failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`geometry ok ${width}x${height}`);
}

if (!mode || mode === "--geometry") {
  await assertGeometry(1024, 700);
  await assertGeometry(1920, 1080);
  process.exit(0);
}

const selector = mode;
const result = await withPage({ width: 1265, height: 699 }, async (page) => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no element: ${selector}`);
  const payload = { selector, box };
  if (property) {
    payload.style = await page.locator(selector).evaluate((el, prop) => {
      return getComputedStyle(el).getPropertyValue(prop);
    }, property);
  }
  return payload;
});
console.log(JSON.stringify(result, null, 2));
