#!/usr/bin/env node
// ABOUTME: Checks public/stylesheets.json against the feature CSS files on disk.
// ABOUTME: Every feature stylesheet is listed once, and every listed file exists.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const publicDir = join(import.meta.dirname, "..", "public");
// Linked directly by index.html, before the listed feature stylesheets.
const LINKED = new Set(["style-theme.css", "design-system.css", "style.css"]);

/** @param {string} dir @returns {string[]} */
function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "vendor" ? [] : cssFiles(full);
    return entry.name.endsWith(".css") ? [relative(publicDir, full).replaceAll("\\", "/")] : [];
  });
}

const listed = JSON.parse(readFileSync(join(publicDir, "stylesheets.json"), "utf8"));
const problems = [];
const seen = new Set();
for (const file of listed) {
  if (seen.has(file)) problems.push(`listed twice: ${file}`);
  seen.add(file);
  if (!existsSync(join(publicDir, file))) problems.push(`listed but missing: ${file}`);
}
for (const file of cssFiles(publicDir)) {
  if (!LINKED.has(file) && !seen.has(file)) problems.push(`not in stylesheets.json: ${file}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[stylesheets] ${problem}`);
  process.exit(1);
}
console.log(`stylesheets ok (${listed.length})`);
