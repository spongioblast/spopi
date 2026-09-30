#!/usr/bin/env node
// ABOUTME: Cross-checks dispatch operation arms against JS gateways.
// ABOUTME: Fails when a host op is missing from control/data or ARCHITECTURE.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const dispatchSource = read("src-tauri/src/host/server/ops/dispatch.rs");
const allOps = [
  ...new Set(
    [...dispatchSource.matchAll(/"([a-z_]+)"\s*(?:\|(?!\|)|=>)/g)].map((match) => match[1]),
  ),
];
const architecture = read("ARCHITECTURE.md");
const control = read("public/app/transport/control-gateway.js");
const data = read("public/app/transport/data-gateway.js");
const prefs = read("public/app/transport/preference-gateway.js");
const gateways = `${control}\n${data}\n${prefs}`;

const missingArch = allOps.filter((op) => !architecture.includes(`\`${op}\``));
const missingJs = allOps.filter((op) => !gateways.includes(op) && !gateways.includes(camel(op)));

function camel(op) {
  return op.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

const errors = [];
if (!allOps.length) errors.push("dispatch.rs has no operation arms");
if (missingArch.length) errors.push(`ARCHITECTURE.md missing host ops: ${missingArch.join(", ")}`);
if (missingJs.length) errors.push(`JS gateways missing host ops: ${missingJs.join(", ")}`);
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(`host ops ok (${allOps.length} names in dispatch arms and gateways)`);
