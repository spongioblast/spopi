// ABOUTME: Fails when a CSS class or id has no matching markup or script reference.
// ABOUTME: State classes toggled by concatenation live in ALLOWED below.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..", "public");

// Toggled by building a class string, or only meaningful as a state hook.
const ALLOWED = new Set([
  "is-open",
  "is-active",
  "is-disabled",
  "is-hidden",
  "is-selected",
  "is-empty",
  "is-error",
  "is-loading",
  "active",
  "hidden",
  "open",
  "on",
  "off",
]);

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "vendor" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, predicate, out);
    else if (predicate(name)) out.push(path);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "url()");
}

function selectorNames(css) {
  const names = new Set();
  const text = stripComments(css);
  for (const match of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1]);
  for (const match of text.matchAll(/#(?![0-9a-fA-F]{3,8}\b)(-?[_a-zA-Z][\w-]*)/g))
    names.add(match[1]);
  return names;
}

const cssFiles = walk(root, (name) => name.endsWith(".css"));
const sourceFiles = walk(root, (name) => name.endsWith(".js") || name.endsWith(".html"));
const sources = sourceFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const dynamicPrefixes = new Set(["xterm-", "cm-"]);
for (const match of sources.matchAll(/([_a-zA-Z][\w-]*?)\$\{/g)) {
  if (match[1].length >= 3) dynamicPrefixes.add(match[1]);
}

function referenced(name) {
  if (ALLOWED.has(name)) return true;
  for (const prefix of dynamicPrefixes) {
    if (name.startsWith(prefix) && name.length > prefix.length) return true;
  }
  const needle = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w-])${needle}(?:$|[^\\w-])`).test(sources);
}

function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function splitSelectors(prelude) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of prelude) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function keepSelector(selector) {
  const names = [...selectorNames(selector)];
  return names.every((name) => referenced(name));
}
function dropUnusedRules(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) {
      out += css.slice(i);
      break;
    }
    const prelude = css.slice(i, open);
    const end = blockEnd(css, open);
    const body = css.slice(open, end + 1);
    const atRule = prelude.trimStart().startsWith("@");
    if (atRule) {
      const inner = dropUnusedRules(body.slice(1, -1));
      if (inner.trim()) out += `${prelude}{${inner}}`;
    } else {
      const kept = splitSelectors(prelude).filter(keepSelector);
      if (kept.length > 0) out += `${kept.join(",")} ${body}`;
    }
    i = end + 1;
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

const fix = process.argv.includes("--fix");
const unused = [];
for (const file of cssFiles) {
  const original = readFileSync(file, "utf8");
  if (fix) {
    const next = dropUnusedRules(original);
    if (next !== original) writeFileSync(file, next);
  }
  for (const name of selectorNames(fix ? readFileSync(file, "utf8") : original)) {
    if (referenced(name)) continue;
    unused.push(`${relative(root, file).replaceAll("\\", "/")}: ${name}`);
  }
}

if (unused.length > 0) {
  console.error("css selectors with no reference:");
  for (const item of unused) console.error(`  ${item}`);
  process.exit(1);
}
console.log("css selectors ok");
