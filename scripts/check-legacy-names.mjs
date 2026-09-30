#!/usr/bin/env node
// ABOUTME: Fails when a source file mentions a retired product name outside the allowlist.
// ABOUTME: Only the license and the README thanks may name the earlier projects.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const pattern = new RegExp("pi" + "cot|pi[_-]studio|\\btau\\b", "i");

const allow = new Set(["LICENSE", "README.md"]);

const roots = [
  "public",
  "extensions",
  "src-tauri/src",
  "src-tauri/build.rs",
  "scripts",
  "docs",
  ".github",
];

const skipDir = new Set(["node_modules", "target", "dist", "vendor", ".git"]);

function walk(path, out) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    if (skipDir.has(path.split(/[\\/]/).at(-1))) return;
    for (const name of readdirSync(path)) walk(join(path, name), out);
    return;
  }
  if (!stat.isFile()) return;
  if (/\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|zip|exe|pdf|mp4|mov|webm)$/i.test(path)) return;
  out.push(path);
}

const files = [];
for (const entry of roots) walk(join(root, entry), files);
for (const name of readdirSync(root)) {
  if (!name.endsWith(".md")) continue;
  files.push(join(root, name));
}

const hits = [];
for (const file of files) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (allow.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) hits.push(`${rel}:${index + 1}:${lines[index].trim()}`);
  }
}

if (hits.length > 0) {
  console.error(hits.join("\n"));
  console.error(`\n${hits.length} legacy name(s)`);
  process.exit(1);
}
console.log("legacy names ok");
