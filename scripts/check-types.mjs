#!/usr/bin/env node
// ABOUTME: Typechecks JSDoc-opted JS and the bridge TypeScript.
// ABOUTME: There is no emit. A failure here is a type error, not a build error.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
