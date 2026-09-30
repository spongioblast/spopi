#!/usr/bin/env node
// ABOUTME: Fails when a module looks up an id that only another module creates.
// ABOUTME: The baseline may only shrink. Delete it when it is empty.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const appRoot = join(root, "public", "app");
const baselinePath = join(root, "scripts", "dom-ownership-baseline.json");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "vendor") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

function rel(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function stripComments(source) {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (match, offset, text) => {
    const quotes = text.slice(0, offset).match(/"/g)?.length ?? 0;
    return quotes % 2 === 1 ? match : "";
  });
  return withoutBlocks.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function createdIds(source) {
  const ids = new Set();
  const text = stripComments(source);
  for (const match of text.matchAll(/\bid\s*:\s*["']([A-Za-z][\w-]*)["']/g)) ids.add(match[1]);
  for (const match of text.matchAll(/\.id\s*=\s*["']([A-Za-z][\w-]*)["']/g)) ids.add(match[1]);
  for (const match of text.matchAll(/\bid\s*=\s*["']([A-Za-z][\w-]*)["']/g)) ids.add(match[1]);
  return ids;
}

function lookupIds(source) {
  const ids = new Set();
  const text = stripComments(source);
  for (const match of text.matchAll(/getElementById\(\s*["']([A-Za-z][\w-]*)["']/g))
    ids.add(match[1]);
  for (const match of text.matchAll(/querySelector(?:All)?\(\s*["'`]([^"'`]*)["'`]/g)) {
    for (const id of match[1].matchAll(/#([A-Za-z][\w-]*)/g)) ids.add(id[1]);
  }
  return ids;
}

function violations() {
  const files = walk(appRoot);
  const creators = new Map();
  const lookups = new Map();
  for (const file of files) {
    const name = rel(file);
    const source = readFileSync(file, "utf8");
    creators.set(name, createdIds(source));
    lookups.set(name, lookupIds(source));
  }
  const createdBy = new Map();
  for (const [name, ids] of creators) {
    for (const id of ids) {
      if (!createdBy.has(id)) createdBy.set(id, new Set());
      createdBy.get(id).add(name);
    }
  }
  /** @type {Map<string, string[]>} */
  const found = new Map();
  for (const [name, ids] of lookups) {
    const foreign = [];
    for (const id of ids) {
      const owners = createdBy.get(id);
      if (!owners || owners.has(name)) continue;
      foreign.push(id);
    }
    if (foreign.length > 0) found.set(name, foreign.sort());
  }
  return found;
}

function baselineEntries() {
  if (!existsSync(baselinePath)) return null;
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  const entries = new Map();
  for (const [name, ids] of Object.entries(parsed)) {
    entries.set(name, [...ids].sort());
  }
  return entries;
}

if (process.argv.includes("--write")) {
  const found = violations();
  const body = {};
  for (const name of [...found.keys()].sort()) body[name] = found.get(name);
  writeFileSync(baselinePath, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote ${found.size} modules`);
  process.exit(0);
}

const found = violations();
const baseline = baselineEntries();
let failed = 0;

if (baseline === null) {
  if (found.size > 0) {
    console.error("dom ownership baseline is missing while cross-module lookups remain");
    for (const [name, ids] of found) console.error(`  ${name}: ${ids.join(", ")}`);
    failed += 1;
  }
} else {
  for (const [name, ids] of found) {
    const allowed = baseline.get(name);
    if (!allowed) {
      console.error(`${name}: new cross-module lookups: ${ids.join(", ")}`);
      failed += 1;
      continue;
    }
    for (const id of ids) {
      if (!allowed.includes(id)) {
        console.error(`${name}: new cross-module lookup #${id}`);
        failed += 1;
      }
    }
  }
  for (const [name, ids] of baseline) {
    const current = found.get(name) ?? [];
    const stale = ids.filter((id) => !current.includes(id));
    if (stale.length > 0) {
      console.error(`${name}: remove settled lookups from the baseline: ${stale.join(", ")}`);
      failed += 1;
    }
  }
}

if (failed > 0) process.exit(1);
const count = [...found.values()].reduce((sum, ids) => sum + ids.length, 0);
console.log(`dom ownership ok (${count} baselined lookups)`);
