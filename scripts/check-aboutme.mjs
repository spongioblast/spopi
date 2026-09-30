#!/usr/bin/env node
// ABOUTME: Requires two ABOUTME lines at the top of source files.
// ABOUTME: An empty baseline file is deleted; a missing file means every source has a header.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const baselinePath = join(root, "scripts", "aboutme-baseline.txt");
const skipDir = new Set(["node_modules", "vendor", "dist", "target", "gen", "resources"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function consider(rel) {
  if (rel.startsWith("public/vendor/") || rel.startsWith("extensions/dist/")) return false;
  if (
    rel.startsWith("src-tauri/target/") ||
    rel.startsWith("src-tauri/gen/") ||
    rel.startsWith("src-tauri/resources/")
  )
    return false;
  return (
    rel.endsWith(".js") ||
    rel.endsWith(".mjs") ||
    rel.endsWith(".ts") ||
    rel.endsWith(".rs") ||
    rel.endsWith(".css")
  );
}

function hasHeader(text, css) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines[0]?.startsWith("#!")) lines.shift();
  const first = lines[0] ?? "";
  const second = lines[1] ?? "";
  const mark = (line) => line.startsWith("// ABOUTME:") || (css && line.startsWith("/* ABOUTME:"));
  return mark(first) && mark(second);
}

const roots = ["public", "extensions", "scripts", "src-tauri/src"].map((dir) => join(root, dir));
const missing = [];
for (const file of roots.flatMap((dir) => walk(dir))) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!consider(rel)) continue;
  const text = readFileSync(file, "utf8");
  const css = rel.endsWith(".css");
  if (css && text.split(/\r?\n/).length <= 40) continue;
  if (!hasHeader(text, css)) missing.push(rel);
}
missing.sort();

const baseline = existsSync(baselinePath)
  ? readFileSync(baselinePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .sort()
  : [];

const missingSet = new Set(missing);
const baselineSet = new Set(baseline);
const added = missing.filter((path) => !baselineSet.has(path));
const stale = baseline.filter((path) => !missingSet.has(path));
if (added.length || stale.length) {
  for (const path of added) console.error(`missing ABOUTME header: ${path}`);
  for (const path of stale) console.error(`ABOUTME baseline can shrink: ${path}`);
  process.exit(1);
}
console.log(`aboutme ok (${missing.length} files still in the baseline)`);
