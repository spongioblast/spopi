#!/usr/bin/env node
// ABOUTME: Builds the browser vendor bundles under public/vendor from node_modules.
// ABOUTME: App code loads the generated files. It does not import node_modules in the browser.
/**
 * Builds browser-only ESM vendor bundles for CodeMirror, PDF.js, and remend.
 *
 * Source modules import @codemirror/* and pdfjs-dist directly from node_modules
 * (resolved by Vitest). At browser runtime, index.html contains an import map
 * that redirects those specifiers to the same-origin generated files under
 * public/vendor/.
 *
 * Outputs:
 *   public/vendor/codemirror.js     — all CodeMirror runtime exports used by the app
 *   public/vendor/pdf.js            — PDF.js facade (getDocument, GlobalWorkerOptions)
 *   public/vendor/pdf.worker.js     — PDF.js worker
 *   public/vendor/xterm.js          — xterm constructors on globalThis.SpopiXterm
 *   public/vendor/chart.js          — Chart.js constructor on globalThis.Chart
 *   public/vendor/tauri-notification.js — Tauri notification browser facade
 *   public/vendor/remend.js         — streaming markdown repair
 */

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "vendor");

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
};

/** @type {import('esbuild').BuildOptions[]} */
const entries = [
  {
    ...common,
    entryPoints: [path.join(ROOT, "public", "codemirror-vendor-entry.js")],
    outfile: path.join(OUT_DIR, "codemirror.js"),
  },
  {
    ...common,
    entryPoints: [path.join(ROOT, "public", "pdf-vendor-entry.js")],
    outfile: path.join(OUT_DIR, "pdf.js"),
  },
  {
    ...common,
    entryPoints: [
      path.join(ROOT, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
    ],
    outfile: path.join(OUT_DIR, "pdf.worker.js"),
  },
  {
    // Classic <script> tags share the global scope. ESM output would leak
    // top-level `var` bindings (xterm/Chart.js both declare helpers that
    // collide with browser APIs such as getComputedStyle) and recurse.
    ...common,
    format: "iife",
    entryPoints: [path.join(ROOT, "public", "terminal-vendor-entry.js")],
    outfile: path.join(OUT_DIR, "xterm.js"),
  },
  {
    ...common,
    format: "iife",
    entryPoints: [path.join(ROOT, "public", "chart-vendor-entry.js")],
    outfile: path.join(OUT_DIR, "chart.js"),
  },
  {
    ...common,
    entryPoints: [path.join(ROOT, "public", "tauri-notification-vendor-entry.js")],
    outfile: path.join(OUT_DIR, "tauri-notification.js"),
  },
  {
    ...common,
    entryPoints: [path.join(ROOT, "node_modules", "remend", "dist", "index.js")],
    outfile: path.join(OUT_DIR, "remend.js"),
    // tsc follows this import from markdown.js. The bundle is generated.
    banner: { js: "// @ts-nocheck" },
  },
];

// Static assets copied verbatim into public/vendor/. Each entry is a
// [source-relative-to-ROOT, destination-filename] pair.
const staticAssets = [["node_modules/@xterm/xterm/css/xterm.css", "xterm.css"]];

function copyStaticAssets() {
  for (const [relSrc, destName] of staticAssets) {
    const src = path.join(ROOT, relSrc);
    const dest = path.join(OUT_DIR, destName);
    fs.copyFileSync(src, dest);
    const sizeKb = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`[build-frontend] ${path.relative(ROOT, dest)} (${sizeKb} KB)`);
  }
}

async function buildOnce() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const entry of entries) {
    await esbuild.build(entry);
    const outPath = entry.outfile;
    const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`[build-frontend] ${path.relative(ROOT, outPath)} (${sizeKb} KB)`);
  }
  copyStaticAssets();
  writePreloadGraph();
}

function writePreloadGraph() {
  const publicDir = path.join(ROOT, "public");
  const modules = [];
  const seen = new Set();
  function walk(file) {
    const rel = path.relative(publicDir, file).replaceAll("\\", "/");
    if (seen.has(rel)) return;
    seen.add(rel);
    modules.push(rel);
    const source = fs.readFileSync(file, "utf8");
    const specifiers = source.matchAll(/^\s*import\s+(?:[^'"\n]+?\s+from\s+)?["'](\.[^"']+)["']/gm);
    for (const match of specifiers) {
      let next = path.resolve(path.dirname(file), match[1]);
      if (!path.extname(next)) next += ".js";
      if (fs.existsSync(next)) walk(next);
    }
  }
  walk(path.join(publicDir, "bootstrap-entry.js"));

  // The feature stylesheets and their cascade order come from the tracked list; the
  // generated graph only adds the module preloads.
  const stylesheets = JSON.parse(fs.readFileSync(path.join(publicDir, "stylesheets.json"), "utf8"));
  const graph = path.join(publicDir, "preload-graph.json");
  fs.writeFileSync(graph, `${JSON.stringify({ modules, stylesheets }, null, 2)}\n`);
  console.log(
    `[build-frontend] preload-graph.json (${modules.length} modules, ${stylesheets.length} stylesheets)`,
  );
}

async function buildWatch() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const contexts = [];
  for (const entry of entries) {
    const ctx = await esbuild.context(entry);
    contexts.push(ctx);
    await ctx.watch();
    console.log(
      `[build-frontend] watching ${path.relative(ROOT, entry.entryPoints[0])} → ${path.relative(ROOT, entry.outfile)}`,
    );
  }
  console.log("[build-frontend] watch mode active. Press Ctrl+C to stop.");
}

async function main() {
  const watch = process.argv.includes("--watch");
  try {
    if (process.argv.includes("--graph-only")) {
      writePreloadGraph();
      return;
    }
    if (watch) {
      await buildWatch();
    } else {
      await buildOnce();
      console.log("[build-frontend] done.");
    }
  } catch (err) {
    console.error("[build-frontend] failed:", err);
    process.exit(1);
  }
}

main();
