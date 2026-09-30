#!/usr/bin/env node
// ABOUTME: Fails when a public/app export is imported by no other module, including tests.
// ABOUTME: Entry files and export default are exempt. A name used only in its file is not exported.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const appRoot = join(repoRoot, "public", "app");
const publicRoot = join(repoRoot, "public");

const exempt = new Set([
  "public/app/app.js",
  "public/app/shell/app-launcher.js",
  "public/bootstrap-entry.js",
]);

function walk(dir, { tests = false } = {}, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "vendor" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, { tests }, out);
    else if (name.endsWith(".js") && (tests || !name.endsWith(".test.js"))) out.push(path);
  }
  return out;
}

function rel(path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function isEntry(path) {
  const name = rel(path);
  return exempt.has(name) || (name.startsWith("public/") && name.endsWith("-vendor-entry.js"));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function exportedNames(source) {
  const text = stripComments(source);
  const names = new Set();
  const decl = /export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(decl)) names.add(match[1]);
  const clause = /export\s*\{([^}]+)\}/g;
  for (const match of text.matchAll(clause)) {
    if (/^\s*export\s*\{[^}]*\}\s*from/.test(`export {${match[1]}} from`)) {
      // Named re-exports are still exports of this file.
    }
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece || piece.startsWith("type ")) continue;
      const alias = piece.split(/\s+as\s+/);
      const exported = (alias[1] || alias[0]).trim();
      if (exported && exported !== "default") names.add(exported);
    }
  }
  return names;
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(join(fromFile, ".."), specifier);
  return base.endsWith(".js") ? base : `${base}.js`;
}

function importedNames(source, fromFile) {
  const text = stripComments(source);
  /** @type {Map<string, { names: Set<string>, namespace: boolean }>} */
  const byFile = new Map();
  const touch = (path, namespace) => {
    const key = rel(path);
    let entry = byFile.get(key);
    if (!entry) {
      entry = { names: new Set(), namespace: false };
      byFile.set(key, entry);
    }
    if (namespace) entry.namespace = true;
    return entry;
  };

  const named = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(named)) {
    const path = resolveSpecifier(fromFile, match[2]);
    if (!path) continue;
    const entry = touch(path, false);
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const original = piece.split(/\s+as\s+/)[0].trim();
      if (original && original !== "type") entry.names.add(original);
    }
  }

  const reexport = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(reexport)) {
    const path = resolveSpecifier(fromFile, match[2]);
    if (!path) continue;
    const entry = touch(path, false);
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const original = piece.split(/\s+as\s+/)[0].trim();
      if (original && original !== "default") entry.names.add(original);
    }
  }

  const star = /import\s*\*\s*as\s+\w+\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(star)) {
    const path = resolveSpecifier(fromFile, match[1]);
    if (path) touch(path, true);
  }

  const returnedImport = /async function (\w+)\(\)[\s\S]*?return import\(\s*["']([^"']+)["']\s*\)/g;
  const helpers = new Map();
  for (const match of text.matchAll(returnedImport)) {
    helpers.set(match[1], match[2].split("?")[0]);
  }
  if (helpers.size > 0) {
    const viaHelper = /(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+(\w+)\(\)/g;
    for (const match of text.matchAll(viaHelper)) {
      const specifier = helpers.get(match[2]);
      if (!specifier) continue;
      const path = resolveSpecifier(fromFile, specifier);
      if (!path) continue;
      const entry = touch(path, false);
      for (const part of match[1].split(",")) {
        const original = part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (original) entry.names.add(original);
      }
    }
  }

  const dynamicNamed =
    /(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(dynamicNamed)) {
    const path = resolveSpecifier(fromFile, match[2].split("?")[0]);
    if (!path) continue;
    const entry = touch(path, false);
    for (const part of match[1].split(",")) {
      const original = part
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (original) entry.names.add(original);
    }
  }

  return byFile;
}

const sources = walk(appRoot);
const importers = walk(publicRoot, { tests: true });
const uses = new Map();
for (const file of importers) {
  const source = readFileSync(file, "utf8");
  for (const [target, info] of importedNames(source, file)) {
    let entry = uses.get(target);
    if (!entry) {
      entry = { names: new Set(), namespace: false };
      uses.set(target, entry);
    }
    if (info.namespace) entry.namespace = true;
    for (const name of info.names) entry.names.add(name);
  }
}

const dead = [];
for (const file of sources) {
  if (isEntry(file)) continue;
  const name = rel(file);
  const usage = uses.get(name);
  if (usage?.namespace) continue;
  for (const exported of exportedNames(readFileSync(file, "utf8"))) {
    if (usage?.names.has(exported)) continue;
    dead.push({ file: name, name: exported });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(dead, null, 2));
} else if (dead.length > 0) {
  console.error(dead.map((item) => `${item.file}: ${item.name}`).join("\n"));
  console.error(`\n${dead.length} dead export(s)`);
  process.exit(1);
} else {
  console.log("dead exports ok");
}
