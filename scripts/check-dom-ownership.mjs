#!/usr/bin/env node
// ABOUTME: Fails when a module looks up an id, or a document-wide class, that only another module creates.
// ABOUTME: The owner passes a root or ref in instead. Nodes only index.html creates have no owner.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const appRoot = join(root, "public", "app");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "vendor") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(path);
  }
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

/** @param {string} list */
function classTokens(list) {
  return list
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter((token) => /^[A-Za-z][\w-]*$/.test(token));
}

function created(source) {
  const names = new Set();
  const text = stripComments(source);
  for (const match of text.matchAll(/\bid\s*[:=]\s*["']([A-Za-z][\w-]*)["']/g))
    names.add(`#${match[1]}`);
  for (const match of text.matchAll(/\.id\s*=\s*["']([A-Za-z][\w-]*)["']/g))
    names.add(`#${match[1]}`);
  for (const match of text.matchAll(/\b(?:className|class)\s*[:=]\s*["'`]([^"'`]*)["'`]/g)) {
    for (const token of classTokens(match[1])) names.add(`.${token}`);
  }
  for (const match of text.matchAll(/classList\.(?:add|toggle)\(([^)]*)\)/g)) {
    for (const quoted of match[1].matchAll(/["']([A-Za-z][\w-]*)["']/g)) names.add(`.${quoted[1]}`);
  }
  return names;
}

function lookups(source) {
  const names = new Set();
  const text = stripComments(source);
  for (const match of text.matchAll(/getElementById\(\s*["']([A-Za-z][\w-]*)["']/g))
    names.add(`#${match[1]}`);
  for (const match of text.matchAll(/querySelector(?:All)?\(\s*["'`]([^"'`]*)["'`]/g)) {
    for (const id of match[1].matchAll(/#([A-Za-z][\w-]*)/g)) names.add(`#${id[1]}`);
  }
  for (const match of text.matchAll(/document\.querySelector(?:All)?\(\s*["'`]([^"'`]*)["'`]/g)) {
    const selector = match[1].replace(/\[[^\]]*\]/g, "").replace(/:[\w-]+(\([^)]*\))?/g, "");
    for (const name of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) names.add(`.${name[1]}`);
  }
  return names;
}

const files = [];
walk(appRoot, files);
const createdBy = new Map();
const lookedUp = new Map();
for (const file of files) {
  const name = rel(file);
  const source = readFileSync(file, "utf8");
  for (const node of created(source)) {
    if (!createdBy.has(node)) createdBy.set(node, new Set());
    createdBy.get(node).add(name);
  }
  lookedUp.set(name, lookups(source));
}

let failed = 0;
for (const [name, nodes] of lookedUp) {
  const foreign = [...nodes].filter((node) => {
    const owners = createdBy.get(node);
    return owners && !owners.has(name);
  });
  if (foreign.length === 0) continue;
  failed += foreign.length;
  console.error(`${name}: looks up nodes another module creates: ${foreign.sort().join(", ")}`);
}

if (failed > 0) process.exit(1);
console.log("dom ownership ok");
