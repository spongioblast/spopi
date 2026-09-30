#!/usr/bin/env node
// ABOUTME: Flags user-facing English literals that are not in the locale catalogs.
// ABOUTME: A baseline may only shrink. Delete the baseline file when it is empty.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const appRoot = join(root, "public", "app");
const baselinePath = join(root, "scripts", "ui-literals-baseline.json");
const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const ASSIGN_RE =
  /(?:textContent|innerText|(?:^|[^\w])title|(?:^|[^\w])placeholder|ariaLabel|aria-label)\s*[:=]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

function rel(path) {
  return relative(root, path).replaceAll("\\", "/");
}

/**
 * @param {string} value
 */
function words(value) {
  return value.trim().split(/\s+/).filter(Boolean);
}

/**
 * @param {string} line
 */
function quoted(line) {
  /** @type {string[]} */
  const found = [];
  for (const match of line.matchAll(STRING_RE)) {
    if (match[1] === "`" && match[2].includes("${")) continue;
    const text = match[2].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (words(text).length >= 3) found.push(text);
  }
  return found;
}

/**
 * @param {string} line
 */
function userFacing(lines, index) {
  const code = lines[index].replace(/^\s*\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (!code.trim()) return [];
  const around = lines.slice(Math.max(0, index - 3), index + 4).join("\n");
  if (/data-i18n|dataset\.i18n|\w+Key\b/.test(around)) return [];
  if (/(?:^|[^\w])(?:t|translate)\(/.test(code)) return [];
  if (!ASSIGN_RE.test(code) && !/\bwhy\s*:/.test(code)) return [];
  return quoted(code);
}

/**
 * @param {string} file
 */
function hitsIn(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  /** @type {string[]} */
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    for (const text of userFacing(lines, index)) hits.push(`${index + 1}:${text}`);
  }
  return hits;
}

function foundMap() {
  /** @type {Record<string, string[]>} */
  const found = {};
  for (const file of walk(appRoot)) {
    const hits = hitsIn(file);
    if (hits.length > 0) found[rel(file)] = hits;
  }
  return found;
}

if (process.argv.includes("--write")) {
  const found = foundMap();
  writeFileSync(baselinePath, `${JSON.stringify(found, null, 2)}\n`);
  const count = Object.values(found).reduce((sum, hits) => sum + hits.length, 0);
  console.log(`wrote ${count} literals`);
  process.exit(0);
}

const found = foundMap();
const baseline = existsSync(baselinePath)
  ? /** @type {Record<string, string[]>} */ (JSON.parse(readFileSync(baselinePath, "utf8")))
  : null;
let failed = 0;

if (baseline === null) {
  const names = Object.keys(found);
  if (names.length > 0) {
    console.error("ui literal baseline is missing while user-facing English remains");
    for (const name of names) console.error(`  ${name}: ${found[name].join(" | ")}`);
    failed += 1;
  }
} else {
  for (const [name, hits] of Object.entries(found)) {
    const allowed = new Set(baseline[name] ?? []);
    for (const hit of hits) {
      if (!allowed.has(hit)) {
        console.error(`${name}: new user-facing literal ${hit}`);
        failed += 1;
      }
    }
  }
  for (const [name, hits] of Object.entries(baseline)) {
    const current = new Set(found[name] ?? []);
    for (const hit of hits) {
      if (!current.has(hit)) {
        console.error(`${name}: remove settled literal from the baseline: ${hit}`);
        failed += 1;
      }
    }
  }
}

if (failed > 0) process.exit(1);
const count = Object.values(found).reduce((sum, hits) => sum + hits.length, 0);
console.log(`ui literals ok (${count} baselined literals)`);
