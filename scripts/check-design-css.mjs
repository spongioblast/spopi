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
let fixes = 0;

for (const path of cssFiles) {
  const displayPath = relative(root, path);
  let source = await readFile(path, "utf8");
  const original = source;
  const lines = source.split("\n");
  let inFontFace = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*@font-face\b/.test(line)) inFontFace = true;
    if (inFontFace) {
      // Descriptors cannot read custom properties: var() there is dropped and every face becomes 400.
      if (/^\s*font-weight\s*:.*\bvar\(/.test(line)) {
        errors += 1;
        console.error(
          `${displayPath}:${index + 1}: error: var() in an @font-face descriptor is ignored. Use a number.`,
        );
      }
      if (line.includes("}")) inFontFace = false;
      continue;
    }
    const declaration = line.match(/^([\t ]*)([\w-]+)\s*:\s*([^;{}]+)(;?)(.*)$/);
    if (!declaration) continue;

    const [, indent, property, rawValue, semicolon, suffix] = declaration;
    if (property.startsWith("--") || displayPath === tokenSource) continue;
    const ruleError = literalRule(property, rawValue.trim());
    if (ruleError && !hasIgnore(lines, index)) {
      const token = property.endsWith("height") ? tokenValue(controlTokens, rawValue.trim()) : null;
      if (fix && token) {
        lines[index] = `${indent}${property}: ${token}${semicolon}${suffix}`;
        fixes += 1;
        continue;
      }
      errors += 1;
      console.error(`${displayPath}:${index + 1}: error: ${ruleError}`);
      continue;
    }
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
  if (displayPath.replaceAll("\\", "/") !== tokenSource) {
    for (const finding of rawColors(source.split("\n"))) {
      errors += 1;
      console.error(
        `${displayPath}:${finding.line}: error: raw colour ${finding.value}. Use a colour token from style-theme.css or add a reasoned design-token-ignore.`,
      );
    }
  }
}

const staticInlinePattern =
  /\.style\.(fontSize|height|minHeight|maxHeight|padding|gap|borderRadius|margin\w*|zIndex|fontWeight|color|background\w*|borderColor)\s*=\s*["'`]([^"'`]*)["'`]/g;
for (const path of jsFiles) {
  if (path.endsWith(".test.js")) continue;
  const source = await readFile(path, "utf8");
  const displayPath = relative(root, path);
  for (const match of source.matchAll(staticInlinePattern)) {
    const value = match[2];
    if (
      value.includes("${") ||
      !/\d+(?:\.\d+)?px|#[0-9a-fA-F]{3,8}\b|\brgba?\(|^\d{3,}$/.test(value)
    ) {
      continue;
    }
    errors += 1;
    const line = source.slice(0, match.index).split("\n").length;
    console.error(
      `${displayPath}:${line}: error: static inline style ${match[1]} = ${JSON.stringify(value)}; use a .ui-* class or CSS token.`,
    );
  }
}

if (fixes > 0) console.log(`Fixed ${fixes} exact design-token replacement(s).`);
if (errors > 0) {
  console.error(`Design check failed with ${errors} error(s).`);
  process.exit(1);
}
console.log("Design check passed.");

/**
 * Margins, overlay z-index, font weight, and control heights. Margins may keep
 * hairline (1px) and negative nudges, and anything inside var(), calc() or clamp().
 * @param {string} property
 * @param {string} value
 * @returns {string | null}
 */
function literalRule(property, value) {
  if (/^margin(-|$)/.test(property) && !/\b(?:calc|clamp|min|max)\(/.test(value)) {
    const bare = value
      .replace(/var\([^)]*\)/g, "")
      .replace(/-\d+(?:\.\d+)?px/g, "")
      .replace(/(?<![\d.])1px\b/g, "");
    if (/\b\d+(?:\.\d+)?px\b/.test(bare)) {
      return `literal ${property}: ${value}. Use --space-* tokens.`;
    }
  }
  if (property === "z-index" && /^\d+$/.test(value) && Number(value) >= 1000) {
    return `z-index ${value}. Use a --z-* token from style-theme.css.`;
  }
  if (property === "font-weight" && /^(\d+|bold|bolder|lighter)$/.test(value)) {
    return `font-weight ${value}. Use a --font-weight-* token.`;
  }
  if ((property === "height" || property === "min-height") && controlTokens.has(value)) {
    return `${property}: ${value}. Use var(${controlTokens.get(value)}).`;
  }
  // A hand-written stack misses fonts on some OS: "SF Mono, Menlo" fell back to Courier New on Windows.
  if (
    property === "font-family" &&
    !/^(?:inherit\b|var\(--font-(?:sans|mono)\b|"SPOPI )/.test(value)
  ) {
    return `font-family: ${value}. Use var(--font-sans) or var(--font-mono).`;
  }
  return null;
}

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

/**
 * Hex and rgb()/hsl() literals in declaration values, including var() fallbacks.
 * Custom property definitions are the place for colours, so they are skipped.
 * A design-token-ignore covers the declaration that follows it.
 * @param {string[]} lines
 */
function rawColors(lines) {
  const found = [];
  let inComment = false;
  let declaration = null;
  let property = "";
  let ignored = false;
  lines.forEach((rawLine, index) => {
    let line = rawLine;
    if (inComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    if (/design-token-ignore:\s*\S/.test(rawLine)) ignored = true;
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    if (line.includes("{")) line = line.slice(line.lastIndexOf("{") + 1);
    if (declaration === null) {
      const start = line.match(/^\s*(--)?([\w-]+)\s*:(?!:)(.*)$/);
      if (!start) return;
      declaration = start[1] ? "custom" : "plain";
      property = start[2];
      line = start[3];
    }
    if (declaration === "plain" && !ignored) {
      const named = /mask/.test(property) ? "" : "|\\b(?:white|black)\\b";
      const pattern = new RegExp(`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?)\\(${named}`, "g");
      for (const match of line.matchAll(pattern)) {
        found.push({ line: index + 1, value: match[0] });
      }
    }
    if (line.includes(";") || line.includes("}")) {
      declaration = null;
      ignored = false;
    }
  });
  return found;
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
