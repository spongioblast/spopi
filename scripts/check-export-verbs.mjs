#!/usr/bin/env node
// ABOUTME: Fails on exports and file names that start with setup, wire, init, attach, install, or bind.
// ABOUTME: Components are mountX and services createX (SPOPI/AGENTS.md); those verbs hide which one a thing is.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const dirs = [join(root, "public", "app"), join(root, "extensions")];
const BANNED = "setup|wire|init|attach|install|bind";
const exportPattern = new RegExp(
  `^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|const|let|class)\\s+((?:${BANNED})[A-Z]\\w*)`,
  "gm",
);
// Package installs are a feature, so install-status.js names its subject, not a wiring step.
const filePattern = /^(?:setup|wire|init|attach|bind)[-_A-Z]/;

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "vendor" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(?:m?js|ts)$/.test(name) && !/\.test\.(?:m?js|ts)$/.test(name)) out.push(path);
  }
  return out;
}

const problems = [];
for (const dir of dirs) {
  for (const path of walk(dir, [])) {
    const file = relative(root, path).replaceAll("\\", "/");
    if (filePattern.test(basename(path)))
      problems.push(`${file}: file name starts with a banned verb`);
    for (const match of readFileSync(path, "utf8").matchAll(exportPattern)) {
      problems.push(`${file}: export ${match[1]} starts with a banned verb`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error("\nUse mountX for components and createX for services.");
  process.exit(1);
}
