#!/usr/bin/env node
// ABOUTME: Runs the product checks in order and stops on the first failure.
// ABOUTME: Each check prints its name and duration. New checks are appended to CHECKS.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const root = join(import.meta.dirname, "..");
const node = process.execPath;

/** Ordered product checks. Later steps append to this list. */
const CHECKS = [
  {
    name: "biome",
    command: node,
    args: [join(root, "node_modules/@biomejs/biome/bin/biome"), "check", "."],
  },
  { name: "design", command: node, args: ["scripts/check-design-css.mjs"] },
  { name: "locales", command: node, args: ["scripts/check-locale-keys.mjs"] },
  { name: "ui-literals", command: node, args: ["scripts/check-ui-literals.mjs"] },
  { name: "aboutme", command: node, args: ["scripts/check-aboutme.mjs"] },
  { name: "host-ops", command: node, args: ["scripts/check-host-ops.mjs"] },
  { name: "legacy-names", command: node, args: ["scripts/check-legacy-names.mjs"] },
  { name: "css-selectors", command: node, args: ["scripts/check-css-selectors.mjs"] },
  { name: "css-tokens", command: node, args: ["scripts/check-css-tokens.mjs"] },
  { name: "stylesheets", command: node, args: ["scripts/check-stylesheets.mjs"] },
  { name: "dead-exports", command: node, args: ["scripts/check-dead-exports.mjs"] },
  { name: "dom-ownership", command: node, args: ["scripts/check-dom-ownership.mjs"] },
  { name: "export-verbs", command: node, args: ["scripts/check-export-verbs.mjs"] },
  { name: "permissions", command: node, args: ["scripts/check-tauri-permissions.js"] },
  { name: "types", command: node, args: ["scripts/check-types.mjs"] },
  { name: "rpc-coverage", command: node, args: ["scripts/check-rpc-coverage.mjs"] },
];

for (const check of CHECKS) {
  const started = performance.now();
  const result = spawnSync(check.command, check.args, { cwd: root, stdio: "inherit" });
  const elapsed = Math.round(performance.now() - started);
  const status = result.status ?? 1;
  console.log(`${check.name} ${status === 0 ? "ok" : "failed"} ${elapsed}ms`);
  if (status !== 0) process.exit(status);
}
