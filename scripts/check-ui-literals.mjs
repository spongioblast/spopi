#!/usr/bin/env node
// ABOUTME: Flags English text that reaches the UI without t(): labels, titles, dialog text, error messages.
// ABOUTME: Template literals count by their fixed words; protocol strings and data values are not UI.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const appRoot = join(root, "public", "app");
const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// Where a literal becomes visible: a text or label property, a label attribute,
// innerHTML, or a pushed detail line. Thrown errors are mostly invariants, so they are not sinks.
const SINK_RE =
  /(?:textContent|innerText|innerHTML|(?:^|[^\w-])title|(?:^|[^\w])placeholder|ariaLabel|aria-label|\blabel)\s*[:=]|setAttribute\(\s*["'](?:aria-label|title|placeholder)["']|details\.push\(|\bwhy\s*:/;
// A literal that only stands in when a key is missing: t("a.b") || "Text", label("a.b", "Text").
const FALLBACK_RE =
  /(?:\)\s*(?:\|\||\?\?)\s*(["'`])(?:\\.|(?!\1)[^\\])*\1)|(?:\(\s*["'][\w-]+(?:\.[\w-]+)+["']\s*,\s*(["'`])(?:\\.|(?!\2)[^\\])*\2)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "vendor") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

function rel(path) {
  return relative(root, path).replaceAll("\\", "/");
}

/** Words a reader sees: template holes, tags, and entities removed. @param {string} value */
function visibleWords(value) {
  return value
    .replace(/\$\{[^}]*\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&\w+;/g, " ")
    .split(/\s+/)
    .filter((word) => /[A-Za-z]{2,}/.test(word));
}

/** @param {string} text */
function looksLikeProse(text) {
  const words = visibleWords(text);
  if (words.length === 0) return false;
  if (/^[a-z][\w.-]*$/.test(text.trim())) return false;
  if (/^[\w./:-]+$/.test(text.trim()) && !/^[A-Z][a-z]+$/.test(text.trim())) return false;
  if (words.length >= 2) return /[A-Z]/.test(words[0][0]) || words.length >= 3;
  return /^[A-Z][a-z]+[.…]?$/.test(words[0]) && text.trim().length > 2;
}

/** @param {string} code */
function literals(code) {
  /** @type {string[]} */
  const found = [];
  for (const match of code.matchAll(STRING_RE)) {
    const text = match[2].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (looksLikeProse(text)) found.push(text);
  }
  return found;
}

/**
 * @param {string[]} lines
 * @param {number} index
 */
function userFacing(lines, index) {
  const code = lines[index].replace(/^\s*(?:\/\/|\*|\/\*).*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (!code.trim() || /console\.\w+\(/.test(code)) return [];
  if (/data-i18n|dataset\.i18n|\w+Key\s*[:=(]/.test(code)) return [];
  if (!SINK_RE.test(code)) return [];
  // An object row names its key next to the English default: { label: "X", labelKey: "a.b" }.
  const neighbours = `${lines[index - 1] ?? ""}\n${lines[index + 1] ?? ""}`;
  if (/^\s*[\w"'-]+\s*:/.test(code) && /\w+Key\b\s*[:,]/.test(neighbours)) return [];
  // Chrome markup: translateSubtree replaces the default through data-i18n-* beside it.
  const block = lines.slice(Math.max(0, index - 3), index + 4).join("\n");
  if (/["']data-i18n(?:-[\w-]+)?["']\s*:|dataset\.i18n\w*\s*=/.test(block)) return [];
  const translated = code
    .replace(FALLBACK_RE, "")
    .replace(/(?:^|[^\w.])(?:t|tn|translate)\(\s*(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "");
  return literals(translated);
}

const problems = [];
for (const file of walk(appRoot)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((_, index) => {
    for (const text of userFacing(lines, index))
      problems.push(`${rel(file)}:${index + 1}: ${text}`);
  });
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} user-facing literals; add a locale key and call t().`);
  process.exit(1);
}
console.log("ui literals ok");
