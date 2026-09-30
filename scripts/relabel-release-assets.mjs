#!/usr/bin/env node
// ABOUTME: After every build uploads, renames release files to `SPOPI_<version>_<os>_<arch>`.
// ABOUTME: Rewrites latest.json to the new names and drops the loose .sig files.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSignatureAsset, relabelManifest, releaseAssetName } from "./release-asset-names.mjs";

const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
if (!repo || !tag) {
  console.error("GITHUB_REPOSITORY and GITHUB_REF_NAME are required");
  process.exit(1);
}
const version = tag.replace(/^v/, "");

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error((result.stderr || result.stdout || `gh ${args.join(" ")}`).trim());
  }
  return result.stdout;
}

// REST, not `gh release view`: the rename and delete endpoints need the numeric asset id.
const assets = JSON.parse(gh(["api", `repos/${repo}/releases/tags/${tag}`])).assets ?? [];
const dir = mkdtempSync(join(tmpdir(), "spopi-latest-"));
const manifestPath = join(dir, "latest.json");
const hasManifest = assets.some((asset) => asset.name === "latest.json");

const renames = new Map();
for (const asset of assets) {
  const next = releaseAssetName(asset.name, version);
  if (next) renames.set(asset.name, next);
}

if (hasManifest) {
  gh(["release", "download", tag, "--repo", repo, "--pattern", "latest.json", "--dir", dir]);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const unsigned = Object.entries(manifest.platforms ?? {}).filter(([, p]) => !p?.signature);
  if (unsigned.length > 0) {
    throw new Error(`latest.json has no signature for ${unsigned.map(([key]) => key).join(", ")}`);
  }
  writeFileSync(manifestPath, `${JSON.stringify(relabelManifest(manifest, renames), null, 2)}\n`);
}

for (const asset of assets) {
  const next = renames.get(asset.name);
  if (!next) continue;
  gh(["api", "-X", "PATCH", `repos/${repo}/releases/assets/${asset.id}`, "-f", `name=${next}`]);
  console.log(`[relabel] ${asset.name} -> ${next}`);
}

if (hasManifest) {
  gh(["release", "upload", tag, manifestPath, "--repo", repo, "--clobber"]);
  console.log("[relabel] latest.json points at the new names");
  for (const asset of assets.filter((item) => isSignatureAsset(item.name))) {
    gh(["api", "-X", "DELETE", `repos/${repo}/releases/assets/${asset.id}`]);
    console.log(`[relabel] removed ${asset.name} (signature is in latest.json)`);
  }
} else {
  console.log("[relabel] no latest.json; kept the .sig files");
}
