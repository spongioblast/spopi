#!/usr/bin/env node
// ABOUTME: Fails when a public stylesheet uses var(--name) and no public CSS defines it.
// ABOUTME: Runtime properties assigned with setProperty are listed in ALLOWED.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const publicDir = join(root, "public");

/** Values assigned from JavaScript, not from a stylesheet. */
const ALLOWED = new Set([
  "--chat-font-size",
  "--preview-font-size",
  "--dock-height",
  "--chat-dock-width",
  "--tabbar-h",
  "--kb-inset",
  "--row-depth",
  "--depth",
  "--nav-w",
  "--pkg-install-pct",
  "--context-pct",
  "--history-flex",
  "--terminal-fullscreen-top",
  "--terminal-fullscreen-left",
  "--terminal-fullscreen-width",
  "--terminal-fullscreen-height",
  // Fullscreen insets use the right edge; width and height are unused today.
  "--terminal-fullscreen-right",
  "--ring-fill",
  "--review-progress",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "vendor" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

const defined = new Set();
const missing = [];

for (const file of walk(publicDir)) {
  const css = blankComments(readFileSync(file, "utf8"));
  for (const match of css.matchAll(/(^|[\s{;])(--[a-zA-Z][\w-]*)\s*:/g)) defined.add(match[2]);
}

for (const file of walk(publicDir)) {
  const rel = relative(root, file).replaceAll("\\", "/");
  const css = blankComments(readFileSync(file, "utf8"));
  const lines = css.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(/var\(\s*(--[a-zA-Z][\w-]*)/g)) {
      const name = match[1];
      if (defined.has(name) || ALLOWED.has(name)) continue;
      missing.push(`${rel}:${index + 1}: undefined custom property ${name}`);
    }
  }
}

if (missing.length > 0) {
  console.error(missing.join("\n"));
  const noun = missing.length === 1 ? "property" : "properties";
  console.error(`\n${missing.length} undefined CSS custom ${noun}`);
  process.exit(1);
}
console.log("css tokens ok");
