// ABOUTME: Tests native application module graph.
// ABOUTME: Includes "only loads module entry points that exist".
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STATIC_IMPORT = /^import(?:[^;\n]*\sfrom\s+|\s*\()\s*["'](\.[^"']+)["']/gm;
const BARE_IMPORT = /^import(?:[^;\n]*\sfrom\s+|\s*\()\s*["']([^./][^"']*)["']/gm;

function collectMissingImports(entryPath) {
  const pending = [entryPath];
  const visited = new Set();
  const missing = [];

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const importedPath = resolve(dirname(filePath), match[1]);
      if (!existsSync(importedPath)) {
        missing.push(`${filePath} imports missing ${importedPath}`);
        continue;
      }
      if (importedPath.endsWith(".js")) pending.push(importedPath);
    }
  }

  return missing;
}

function collectBareImports(entryPath) {
  const pending = [entryPath];
  const visited = new Set();
  const bareImports = new Set();

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(BARE_IMPORT)) bareImports.add(match[1]);
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const importedPath = resolve(dirname(filePath), match[1]);
      if (existsSync(importedPath) && importedPath.endsWith(".js")) pending.push(importedPath);
    }
  }

  return [...bareImports].sort();
}

const NAMED_IMPORT = /^import\s+(?:[\w$]+\s*,\s*)?\{([^}]+)\}\s+from\s+["'](\.[^"']+)["']/gm;

function parseImportedNames(clause) {
  return clause
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim(),
    )
    .filter(Boolean);
}

function collectExportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([\w$]+)/gm,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export\s+\{([^}]+)\}/gm)) {
    for (const part of match[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const exported = (bits[1] || bits[0]).trim();
      if (exported) names.add(exported);
    }
  }
  return names;
}

function collectMissingNamedImports(entryPath) {
  const pending = [entryPath];
  const visited = new Set();
  const missing = [];

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(NAMED_IMPORT)) {
      const importedPath = resolve(dirname(filePath), match[2]);
      if (!importedPath.endsWith(".js") || !existsSync(importedPath)) continue;
      const exported = collectExportedNames(readFileSync(importedPath, "utf8"));
      for (const name of parseImportedNames(match[1])) {
        if (!exported.has(name)) {
          missing.push(`${filePath} imports '${name}' from ${importedPath}`);
        }
      }
      pending.push(importedPath);
    }
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const importedPath = resolve(dirname(filePath), match[1]);
      if (existsSync(importedPath) && importedPath.endsWith(".js")) pending.push(importedPath);
    }
  }

  return missing;
}

function firstImportAfterTopLevelAwait(filePath) {
  const source = readFileSync(filePath, "utf8");
  const awaitMatch = source.match(/^await\s/m);
  if (!awaitMatch) return null;
  const afterAwait = source.slice(awaitMatch.index);
  const lateImport = afterAwait.match(/^import\s/m);
  if (!lateImport) return null;
  const line = source.slice(0, awaitMatch.index + lateImport.index).split("\n").length;
  return line;
}

describe("native application module graph", () => {
  it("only loads module entry points that exist", () => {
    const publicDir = resolve(process.cwd(), "public");
    const indexHtml = readFileSync(resolve(publicDir, "index.html"), "utf8");
    const moduleSources = [
      ...indexHtml.matchAll(/<script\s+type=["']module["']\s+src=["']([^"']+)["']/g),
    ]
      .map(([, source]) => source)
      // Root-absolute sources come from the UI overlay, which the host answers
      // even when the file does not exist.
      .filter((source) => !source.startsWith("/"));

    expect(
      moduleSources.map((source) => resolve(publicDir, source)).filter((path) => !existsSync(path)),
    ).toEqual([]);
  });

  it("does not request missing modules that the static fallback serves as HTML", () => {
    const entryPath = resolve(process.cwd(), "public/app/app.js");

    expect(collectMissingImports(entryPath)).toEqual([]);
  });

  it("imports only names that the target module exports", () => {
    const entryPath = resolve(process.cwd(), "public/app/app.js");

    expect(collectMissingNamedImports(entryPath)).toEqual([]);
  });

  it("declares every static import before the first top-level await", () => {
    const entryPath = resolve(process.cwd(), "public/app/app.js");

    expect(firstImportAfterTopLevelAwait(entryPath)).toBeNull();
  });

  it("maps every browser package import to a same-origin vendor bundle", () => {
    const entryPath = resolve(process.cwd(), "public/app/app.js");
    const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
    const importMapSource = indexHtml.match(
      /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/,
    )?.[1];
    const importMap = JSON.parse(importMapSource).imports;

    expect(collectBareImports(entryPath).filter((specifier) => !importMap[specifier])).toEqual([]);
  });

  it("puts the import map before every module load, as Firefox requires", () => {
    const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
    const map = indexHtml.indexOf('<script type="importmap">');
    // The host inserts the modulepreload links just before style.css.
    expect(map).toBeGreaterThan(-1);
    expect(map).toBeLessThan(indexHtml.indexOf('<link rel="stylesheet" href="style.css" />'));
    expect(map).toBeLessThan(indexHtml.indexOf('type="module"'));
  });
});
