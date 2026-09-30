// ABOUTME: Tests theme-bootstrap.
// ABOUTME: Includes "applies the saved theme before theme CSS can paint".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const html = readFileSync(join(process.cwd(), "public/index.html"), "utf8");

function themeBootstrapSource() {
  const match = html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/);
  expect(match, "index.html should contain the synchronous theme bootstrap").not.toBeNull();
  return match[1];
}

function runThemeBootstrap(cookieValue, scheme) {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-scheme");
  document.cookie = `spopi-theme=${encodeURIComponent(cookieValue)}; Path=/`;
  document.cookie = scheme ? `spopi-scheme=${scheme}; Path=/` : "spopi-scheme=; Max-Age=0; Path=/";
  new Function(themeBootstrapSource())();
  const { theme, scheme: resolved } = document.documentElement.dataset;
  return [theme, resolved];
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-scheme");
  document.cookie = "spopi-theme=; Max-Age=0; Path=/";
  document.cookie = "spopi-scheme=; Max-Age=0; Path=/";
});

test("applies the saved theme before theme CSS can paint", () => {
  const bootstrapIndex = html.indexOf('<script id="theme-bootstrap">');
  const themeCssIndex = html.indexOf('<link rel="stylesheet" href="style-theme.css"');

  expect(bootstrapIndex).toBeGreaterThan(-1);
  expect(bootstrapIndex).toBeLessThan(themeCssIndex);
  expect(runThemeBootstrap("clean")).toEqual(["clean", "light"]);
});

test.each([
  ["light", "terracotta", "light"],
  ["dark", "night", "dark"],
  ["not a theme", "dawn", "dark"],
])("normalizes saved theme %s to %s during bootstrap", (saved, expected, scheme) => {
  expect(runThemeBootstrap(saved)).toEqual([expected, scheme]);
});

test("keeps a theme id it does not know and takes its scheme from the cookie", () => {
  expect(runThemeBootstrap("pink", "light")).toEqual(["pink", "light"]);
  expect(runThemeBootstrap("rose")).toEqual(["rose", "dark"]);
});

test("a built-in theme keeps its own scheme over a stale cookie", () => {
  expect(runThemeBootstrap("sage", "dark")).toEqual(["sage", "light"]);
});
