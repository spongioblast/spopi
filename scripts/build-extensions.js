#!/usr/bin/env node
// ABOUTME: Bundles each Pi extension into a self-contained file under extensions/dist.
// ABOUTME: The packaged app ships those bundles without this repo's node_modules.
/**
 * Bundle each pi extension TypeScript source under `extensions/` into a
 * self-contained CommonJS file under `extensions/dist/`.
 *
 * Why this exists
 * ---------------
 * pi loads extensions with jiti and resolves their `import` statements via
 * Node's module algorithm at runtime. In dev that works because the source
 * lives next to this repo's `node_modules/`. Inside a packaged `.app`, the
 * raw `extensions/*.ts` is shipped without `node_modules`. Bundling here
 * inlines runtime deps so shipped extensions are fully self-contained.
 *
 * Notes
 * - We keep node built-ins external (esbuild does this automatically with
 *   `platform: "node"`).
 * - `@earendil-works/pi-coding-agent` (and its legacy `@mariozechner/...`
 *   alias) are external too: extensions only `import type` from them, but we
 *   still mark them external defensively in case any value-level imports are
 *   added later — the pi runtime provides those at load time.
 * - Output is `.mjs` (ESM). pi's extension loader treats the module's
 *   `export default` as the factory function. Bundling as CJS hides the
 *   default behind `module.exports.default`, which jiti does not unwrap, so
 *   pi rejects it with "Extension does not export a valid factory function".
 */

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "extensions");
const OUT_DIR = path.join(SRC_DIR, "dist");

// [inputPath, outputName] — outputName defaults to inputPath with .ts→.mjs
const PERMISSION_PKG = path.join(ROOT, "node_modules", "@gotgenes", "pi-permission-system");

// The whole of extensions/dist ships in the installer, so `--release` leaves
// out the fake provider that only tests and smoke runs load.
const RELEASE = process.argv.includes("--release");

const ENTRIES = [
  ["spopi-bridge.ts"],
  ["spopi-verify.ts"],
  ["spopi-tool-output.ts"],
  [path.join(PERMISSION_PKG, "src", "index.ts"), "pi-permission-system.mjs"],
  ...(RELEASE ? [] : [["testing/spopi-fake-provider.ts", "testing/spopi-fake-provider.mjs"]]),
];

const EXTERNAL = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
];

function permissionPlugin() {
  return {
    name: "pi-permission-system",
    setup(build) {
      build.onResolve({ filter: /^#src\// }, (args) => {
        const rel = args.path.slice("#src/".length);
        const base = path.join(PERMISSION_PKG, "src", rel);
        const candidates = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.js`,
          path.join(base, "index.ts"),
        ];
        const found = candidates.find(
          (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
        );
        return found ? { path: found } : null;
      });
      build.onLoad({ filter: /access-intent[\\/]bash[\\/]parser\.ts$/ }, (args) => {
        let contents = fs.readFileSync(args.path, "utf8");
        if (!contents.includes('from "node:url"')) {
          contents = `import { fileURLToPath } from "node:url";\n${contents}`;
        }
        contents = contents
          .replace(
            'const treeSitterWasm = req.resolve("web-tree-sitter/web-tree-sitter.wasm");',
            'const treeSitterWasm = fileURLToPath(new URL("./web-tree-sitter.wasm", import.meta.url));',
          )
          .replace(
            'const bashWasm = req.resolve("tree-sitter-bash/tree-sitter-bash.wasm");',
            'const bashWasm = fileURLToPath(new URL("./tree-sitter-bash.wasm", import.meta.url));',
          );
        return { contents, loader: "ts" };
      });
    },
  };
}

function copyPermissionWasm() {
  fs.copyFileSync(
    path.join(ROOT, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
    path.join(OUT_DIR, "web-tree-sitter.wasm"),
  );
  fs.copyFileSync(
    path.join(ROOT, "node_modules", "tree-sitter-bash", "tree-sitter-bash.wasm"),
    path.join(OUT_DIR, "tree-sitter-bash.wasm"),
  );
}

// spopi-verify resolves its skills relative to its own bundle.
function copyVerifySkills() {
  const from = path.join(SRC_DIR, "spopi-verify", "skills");
  const to = path.join(OUT_DIR, "spopi-verify", "skills");
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

async function buildOne(entrySpec) {
  const [entry, outName] = Array.isArray(entrySpec) ? entrySpec : [entrySpec];
  const inFile = path.isAbsolute(entry) ? entry : path.join(SRC_DIR, entry);
  if (!fs.existsSync(inFile)) {
    console.warn(`[build-extensions] skip missing entry: ${entry}`);
    return;
  }
  const outFile = path.join(OUT_DIR, outName || entry.replace(/\.ts$/, ".mjs"));
  await esbuild.build({
    entryPoints: [inFile],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: EXTERNAL,
    plugins: outName === "pi-permission-system.mjs" ? [permissionPlugin()] : [],
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "info",
    // Some bundled CJS deps expect `require` / `__dirname` / `__filename`
    // to exist at runtime. esbuild's ESM output does not provide them, so we
    // shim them via banner.
    banner: {
      js: [
        "import { createRequire as __piCreateRequire } from 'node:module';",
        "import { fileURLToPath as __piFileURLToPath } from 'node:url';",
        "import { dirname as __piDirname } from 'node:path';",
        "const require = __piCreateRequire(import.meta.url);",
        "const __filename = __piFileURLToPath(import.meta.url);",
        "const __dirname = __piDirname(__filename);",
      ].join("\n"),
    },
  });
  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`[build-extensions] ${entry} -> ${path.relative(ROOT, outFile)} (${sizeKb} KB)`);
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  require("node:child_process").execFileSync(
    process.execPath,
    [path.join(__dirname, "build-ui-map.mjs")],
    { stdio: "inherit" },
  );
  for (const entry of ENTRIES) {
    await buildOne(entry);
  }
  copyPermissionWasm();
  copyVerifySkills();
}

main().catch((err) => {
  console.error("[build-extensions] failed:", err);
  process.exit(1);
});
