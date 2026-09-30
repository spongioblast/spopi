#!/usr/bin/env bun
// ABOUTME: Checks public CSS for design-token values instead of raw dimensions.
// ABOUTME: Pass --fix to rewrite the safe token substitutions in place.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const fix = process.argv.includes("--fix");
const tokenSource = "public/style-theme.css";
function publicRel(path) {
  return relative(root, path).replaceAll("\\", "/");
}

const cssFiles = (await walk(publicDir)).filter(
  (path) => extname(path) === ".css" && !publicRel(path).startsWith("public/vendor/"),
);
const jsFiles = (await walk(publicDir)).filter(
  (path) => extname(path) === ".js" && !publicRel(path).startsWith("public/vendor/"),
);

const exactTokens = new Map([
  ["2px", "--space-0-5"],
  ["4px", "--space-1"],
  ["6px", "--space-1-5"],
  ["8px", "--space-2"],
  ["12px", "--space-3"],
  ["16px", "--space-4"],
  ["20px", "--space-5"],
  ["24px", "--space-6"],
  ["32px", "--space-8"],
  ["40px", "--space-10"],
  ["48px", "--space-12"],
]);
const fontTokens = new Map([
  ["12px", "--font-size-sm"],
  ["14px", "--font-size-md"],
  ["16px", "--font-size-lg"],
  ["20px", "--font-size-xl"],
  ["24px", "--font-size-2xl"],
]);
const radiusTokens = new Map([
  ["4px", "--radius-xs"],
  ["6px", "--radius-sm"],
  ["10px", "--radius-md"],
  ["16px", "--radius"],
  ["24px", "--radius-lg"],
  ["999px", "--radius-pill"],
]);
const controlTokens = new Map([
  ["24px", "--control-height-xs"],
  ["28px", "--control-height-sm"],
  ["32px", "--control-height-md"],
  ["40px", "--control-height-lg"],
]);

const guardedProperties = new Set([
  "font-size",
  "padding",
  "padding-block",
  "padding-block-end",
  "padding-block-start",
  "padding-bottom",
  "padding-inline",
  "padding-inline-end",
  "padding-inline-start",
  "padding-left",
  "padding-right",
  "padding-top",
  "gap",
  "column-gap",
  "row-gap",
  "border-radius",
]);

let errors = 0;
let warnings = 0;
let fixes = 0;

for (const path of cssFiles) {
  const displayPath = relative(root, path);
  let source = await readFile(path, "utf8");
  const original = source;
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const declaration = line.match(/^([\t ]*)([\w-]+)\s*:\s*([^;{}]+)(;?)(.*)$/);
    if (!declaration) continue;

    const [, indent, property, rawValue, semicolon, suffix] = declaration;
    if (property.startsWith("--") || displayPath === tokenSource) continue;
    if (!guardedProperties.has(property)) continue;
    if (!/\b\d+(?:\.\d+)?px\b/.test(rawValue)) continue;
    if (onlyLayoutLiteralsRemain(rawValue)) continue;
    if (hasIgnore(lines, index)) continue;

    const replacement = exactReplacement(property, rawValue.trim());
    if (fix && replacement) {
      lines[index] = `${indent}${property}: ${replacement}${semicolon}${suffix}`;
      fixes += 1;
      continue;
    }

    errors += 1;
    const suggestion = replacement
      ? ` Use ${replacement}.`
      : ` Choose a token from style-theme.css or add a reasoned design-token-ignore.`;
    console.error(
      `${displayPath}:${index + 1}: error: literal ${property}: ${rawValue.trim()}.${suggestion}`,
    );
  }

  source = lines.join("\n");
  if (fix && source !== original) await writeFile(path, source);
}

const staticInlinePattern =
  /\.style\.(fontSize|height|minHeight|maxHeight|padding|gap|borderRadius)\s*=\s*["'`]([^"'`]*\d+(?:\.\d+)?px[^"'`]*)["'`]/g;
for (const path of jsFiles) {
  const source = await readFile(path, "utf8");
  const displayPath = relative(root, path);
  for (const match of source.matchAll(staticInlinePattern)) {
    if (match[2].includes("${")) continue;
    warnings += 1;
    const line = source.slice(0, match.index).split("\n").length;
    console.warn(
      `${displayPath}:${line}: warning: static inline style ${match[1]} = ${JSON.stringify(match[2])}; prefer a .ui-* class or CSS token.`,
    );
  }
}

if (fixes > 0) console.log(`Fixed ${fixes} exact design-token replacement(s).`);
if (warnings > 0)
  console.warn(`Design check reported ${warnings} JavaScript inline-style warning(s).`);
if (errors > 0) {
  console.error(`Design check failed with ${errors} CSS error(s).`);
  process.exit(1);
}
console.log("Design check passed.");

function exactReplacement(property, value) {
  if (/\bvar\(/.test(value)) return null;
  if (property === "font-size") return tokenValue(fontTokens, value);
  if (property === "border-radius") return replaceComponents(radiusTokens, value);
  if (property.includes("padding") || property.includes("gap")) {
    return replaceComponents(exactTokens, value);
  }
  return tokenValue(controlTokens, value);
}

function tokenValue(tokens, value) {
  const token = tokens.get(value);
  return token ? `var(${token})` : null;
}

function replaceComponents(tokens, value) {
  const parts = value.split(/\s+/);
  const replaced = parts.map((part) => {
    if (part === "0") return part;
    const token = tokens.get(part);
    return token ? `var(${token})` : null;
  });
  return replaced.every(Boolean) ? replaced.join(" ") : null;
}

function onlyLayoutLiteralsRemain(value) {
  const withoutTokens = value.replace(/var\([^)]*\)/g, "");
  const literals = [...withoutTokens.matchAll(/\b\d+(?:\.\d+)?px\b/g)].map((match) => match[0]);
  return (
    literals.length > 0 && literals.every((literal) => literal === "0px" || literal === "960px")
  );
}

function hasIgnore(lines, index) {
  const sameLine = lines[index].match(/design-token-ignore:\s*(\S.+?)(?:\*\/|$)/);
  const previousLine = lines[index - 1]?.match(/design-token-ignore:\s*(\S.+?)(?:\*\/|$)/);
  return Boolean(sameLine?.[1] || previousLine?.[1]);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return paths.flat();
}
