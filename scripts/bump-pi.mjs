// ABOUTME: Moves SPOPI to another Pi release: pins, types package, binary, extensions, generated fixtures.
// ABOUTME: Usage: bun run bump:pi <version>. It commits nothing; docs/PI_BUMP.md lists what to check after.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePiVersion, parsePiSums, pinPiDevDependency } from "./pi-sums.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pinPath = join(root, "scripts", "pi-version.json");
const packagePath = join(root, "package.json");
const bun = process.versions.bun ? process.execPath : "bun";

function log(message) {
  console.log(`[bump-pi] ${message}`);
}

function run(args) {
  log(`bun ${args.join(" ")}`);
  const result = spawnSync(bun, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`bun ${args.join(" ")} failed (exit ${result.status ?? result.signal})`);
  }
}

async function main() {
  const version = normalizePiVersion(process.argv[2]);
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  const previous = pin.version;

  const sumsUrl = `https://github.com/earendil-works/pi/releases/download/v${version}/SHA256SUMS`;
  log(`reading ${sumsUrl}`);
  const response = await fetch(sumsUrl);
  if (!response.ok) throw new Error(`SHA256SUMS for v${version}: HTTP ${response.status}`);
  const sha256 = parsePiSums(await response.text());

  writeFileSync(pinPath, `${JSON.stringify({ ...pin, version, sha256 }, null, 2)}\n`);
  writeFileSync(packagePath, pinPiDevDependency(readFileSync(packagePath, "utf8"), version));
  log(`pinned Pi ${previous} -> ${version}`);

  run(["install"]);
  run(["run", "fetch:pi"]);
  run(["run", "build:extensions"]);
  run(["run", "scripts/smoke-pi-rpc.js", "--update"]);
  run(["run", "scripts/testing/make-session-fixtures.mjs"]);
  run(["x", "biome", "format", "--write", "tests/fixtures/pi-rpc", "tests/fixtures/pi-sessions"]);

  log("done. Not regenerated, recheck by hand against the new Pi:");
  log("  tests/fixtures/pi-cli/list.txt (pi list)");
  log("  tests/fixtures/pi-cli/mcp-list-*.json (pi mcp list --json, neutral paths)");
  log("  tests/fixtures/pi-sessions/codemode-nested.jsonl (a codemode session)");
  log(
    "Then: git diff tests/fixtures, bun run smoke:mcp, bun run smoke:stream, and the checks in docs/PI_BUMP.md.",
  );
}

main().catch((error) => {
  console.error(`[bump-pi] FAIL: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
