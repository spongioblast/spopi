#!/usr/bin/env node
// ABOUTME: Writes ui-map.md from the ABOUTME line of every public/app file and top-level stylesheet.
// ABOUTME: The customize skill reads it. Do not edit the generated file by hand.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const shipped = join(root, "public");
const app = join(shipped, "app");
const out = join(root, "src-tauri", "resources", "skills", "spopi-customize", "ui-map.md");

function isMapped(name) {
  return (name.endsWith(".js") || name.endsWith(".css")) && !name.endsWith(".test.js");
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (isMapped(name)) files.push(path);
  }
  return files;
}

function about(file) {
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((text) => text.startsWith("// ABOUTME:") || text.startsWith("/* ABOUTME:"));
  return line
    ? line
        .replace(/^\/\*\s*ABOUTME:\s*/, "")
        .replace(/^\/\/ ABOUTME:\s*/, "")
        .replace(/\s*\*\/$/, "")
    : "(no ABOUTME)";
}

const groups = new Map();
const add = (domain, file) => {
  const rel = relative(shipped, file).replaceAll("\\", "/");
  const rows = groups.get(domain) || [];
  rows.push(`- \`${rel}\` — ${about(file)}`);
  groups.set(domain, rows);
};

const topStyles = readdirSync(shipped)
  .filter((name) => name.endsWith(".css"))
  .sort()
  .map((name) => join(shipped, name));
for (const file of topStyles) add("styles", file);

for (const file of walk(app).sort()) {
  const rel = relative(app, file).replaceAll("\\", "/");
  add(rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "app", file);
}

const body = [
  "# SPOPI UI map",
  "",
  "Generated. Do not edit by hand. Paths are relative to the shipped UI folder; the same path in the overlay replaces the file. Tests are left out.",
  "",
];
for (const [domain, rows] of [...groups.entries()].sort()) {
  body.push(`## ${domain}`, "", ...rows, "");
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body.join("\n"));
console.log(`[build-ui-map] ${groups.size} domains`);
