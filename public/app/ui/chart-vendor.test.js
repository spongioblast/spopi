// ABOUTME: Usage charts must load Chart.js from the same-origin vendor bundle.
// ABOUTME: Remote CDN scripts fail on Windows WebView with ERR_CERT_AUTHORITY_INVALID.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});

test("Usage loads Chart.js from the same-origin vendor bundle", () => {
  const html = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  const usage = readFileSync(
    resolve(process.cwd(), "public/app/settings/cost-dashboard.js"),
    "utf8",
  );
  expect(html).not.toContain("vendor/chart.js");
  expect(html).not.toContain("vendor/xterm.js");
  expect(usage).toContain('loadScriptOnce("vendor/chart.js")');
  expect(html).not.toMatch(/cdn\.jsdelivr\.net/);
  expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//);
});

test("Tauri CSP does not allow a remote Chart.js origin", () => {
  const conf = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  );
  const csp = conf.app?.security?.csp ?? "";
  expect(csp).not.toMatch(/cdn\.jsdelivr\.net/);
  expect(csp).toMatch(/script-src 'self'/);
});

test("chart vendor bundle exposes Chart without clobbering getComputedStyle", () => {
  const source = readFileSync(resolve(process.cwd(), "public/vendor/chart.js"), "utf8");
  const nativeGetComputedStyle = globalThis.getComputedStyle;
  runInThisContext(source, { filename: "chart.js" });
  expect(typeof globalThis.Chart).toBe("function");
  expect(globalThis.getComputedStyle).toBe(nativeGetComputedStyle);
  const canvas = document.createElement("canvas");
  expect(() => globalThis.getComputedStyle(canvas)).not.toThrow();
});
