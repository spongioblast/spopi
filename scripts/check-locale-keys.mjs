#!/usr/bin/env node
// ABOUTME: Fails when locale JSON files do not share the same leaf keys.
// ABOUTME: A new English string has to land in every other locale in the same change.
/**
 * Fail if public/locales/*.json do not share the same leaf key set.
 *
 * Adding a string in one language without the matching keys in every other
 * locale file is a lint error. Nested objects are compared by dotted path
 * (sidebar.rename === "sidebar.rename").
 *
 * Run:  node scripts/check-locale-keys.mjs
 * Exit: 0 = all locales match, 1 = missing keys or invalid JSON
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DYNAMIC_PREFIXES = [
  "nav.",
  "git.",
  "dock.",
  "tools.",
  "subagents.state.",
  "dialogs.",
  "settings.fontLevel.",
  "settings.installSkills.",
  "settings.resources.",
  "settings.thinkingLevels.",
  "files.preview.markitdown.",
  "files.git.",
  "composer.approval.",
];

export function flattenKeys(obj, prefix = "") {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

export function listLocaleFiles(localesDir) {
  return readdirSync(localesDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

export function loadLocale(localesDir, filename) {
  const filePath = join(localesDir, filename);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filename}: invalid JSON (${error.message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filename}: root value must be a JSON object`);
  }
  return parsed;
}

/**
 * Compare leaf-key sets across locales.
 * @returns {{ unionSize: number, reports: Array<{ file: string, missing: string[] }> }}
 */
export function diffLocaleKeys(locales) {
  const union = new Set();
  for (const locale of locales) {
    for (const key of locale.keys) union.add(key);
  }
  const reports = [];
  for (const locale of locales) {
    const missing = [...union].filter((key) => !locale.keys.has(key)).sort();
    if (missing.length > 0) {
      reports.push({ file: locale.file, missing });
    }
  }
  return { unionSize: union.size, reports };
}

export function checkLocaleKeys(localesDir) {
  const files = listLocaleFiles(localesDir);
  if (files.length === 0) {
    throw new Error(`no *.json files in ${localesDir}`);
  }
  const locales = files.map((file) => {
    const messages = loadLocale(localesDir, file);
    return { file, keys: new Set(flattenKeys(messages)) };
  });
  return { files, ...diffLocaleKeys(locales) };
}

export function referencedKeySet(sourceText) {
  const keys = new Set();
  const patterns = [
    /\bt\(\s*["']([^"']+)["']/g,
    /data-i18n[\w-]*\s*=\s*["']([^"']+)["']/g,
    /["']data-i18n[\w-]*["']\s*:\s*["']([^"']+)["']/g,
    /labelKey\s*:\s*["']([^"']+)["']/g,
    /titleKey\s*:\s*["']([^"']+)["']/g,
    /["']([a-z][\w]*(?:\.[a-z][\w]*)+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) keys.add(match[1]);
  }
  return keys;
}

function walkText(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "vendor" || name === "node_modules" || name === "locales") continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkText(path, out);
    else if (/\.(js|mjs|html|css|ts)$/.test(name)) out.push(readFileSync(path, "utf8"));
  }
  return out;
}

export function unreferencedLocaleKeys(keys, sourceText) {
  const referenced = referencedKeySet(sourceText);
  return [...keys]
    .filter((key) => {
      if (DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
      return !referenced.has(key);
    })
    .sort();
}

function formatReport({ files, unionSize, reports }) {
  const names = files.map((file) => file.replace(/\.json$/, "")).join(", ");
  const header = `Checking locale key parity (${files.length} files, ${unionSize} keys): ${names}`;
  if (reports.length === 0) {
    return { ok: true, text: `${header}\n✓ all locale files share ${unionSize} keys\n` };
  }
  const lines = [header, ""];
  for (const { file, missing } of reports) {
    lines.push(`✗ ${file} missing ${missing.length} key(s):`);
    for (const key of missing) {
      lines.push(`    ${key}`);
    }
  }
  lines.push("");
  lines.push("Locale files must share the same keys. Add the missing keys above.");
  lines.push("");
  return { ok: false, text: `${lines.join("\n")}\n` };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const localesDir = join(root, "public", "locales");
  let result;
  try {
    result = checkLocaleKeys(localesDir);
  } catch (error) {
    console.error(`✗ locale key check failed: ${error.message}`);
    process.exit(1);
  }
  const { ok, text } = formatReport(result);
  if (!ok) {
    process.stderr.write(text);
    process.exit(1);
  }
  process.stdout.write(text);
  const en = loadLocale(localesDir, "en.json");
  const source = walkText(join(root, "public"))
    .concat(walkText(join(root, "extensions")))
    .join("\n");
  const unused = unreferencedLocaleKeys(flattenKeys(en), source);
  if (unused.length > 0) {
    console.error(`${unused.length} unreferenced locale key(s):`);
    console.error(unused.join("\n"));
    process.exit(1);
  }
  console.log("locale references ok");
}

if (isDirectRun()) {
  main();
}
