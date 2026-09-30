#!/usr/bin/env node
// ABOUTME: Runs cargo check, clippy, unit tests, and an advisory format check.
// ABOUTME: Stops on the first hard failure. Format drift is printed and does not fail the run.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const manifest = join(root, "src-tauri", "Cargo.toml");

// tauri-build refuses to compile while a bundled resource path is missing, and the
// frontend stage only exists after stage:frontend, which a clean checkout has not run.
if (!existsSync(join(root, "src-tauri", "target", "frontend-stage", "public"))) {
  const stage = spawnSync(process.execPath, [join(root, "scripts", "stage-frontend.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if ((stage.status ?? 1) !== 0) process.exit(stage.status ?? 1);
}
const cargoBin = join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  CARGO_HTTP_CHECK_REVOKE: "false",
  PATH: `${cargoBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
};

function cargo(args, { quiet = false } = {}) {
  return spawnSync("cargo", args, {
    cwd: root,
    env,
    stdio: quiet ? "ignore" : "inherit",
  });
}

const probe = cargo(["--version"], { quiet: true });
if ((probe.status ?? 1) !== 0) {
  console.error(`error: cargo not found in PATH (looked under ${cargoBin})`);
  process.exit(127);
}

const steps = [
  {
    label: "cargo check (all targets)",
    args: ["check", "--manifest-path", manifest, "--all-targets"],
  },
  {
    label: "cargo clippy (warnings as errors)",
    args: ["clippy", "--manifest-path", manifest, "--all-targets", "--", "-D", "warnings"],
  },
  { label: "cargo test (unit)", args: ["test", "--manifest-path", manifest, "--quiet"] },
];

for (const step of steps) {
  console.log(`==> ${step.label}`);
  const result = cargo(step.args);
  if ((result.status ?? 1) !== 0) {
    if (step.label.startsWith("cargo test")) console.error("    unit tests failed");
    process.exit(result.status ?? 1);
  }
}

const fmtProbe = cargo(["fmt", "--version"], { quiet: true });
if ((fmtProbe.status ?? 1) === 0) {
  console.log("==> cargo fmt --check (advisory)");
  const fmt = cargo(["fmt", "--manifest-path", manifest, "--check"]);
  if ((fmt.status ?? 1) !== 0) {
    console.log(
      `    formatting drift detected; run 'cargo fmt --manifest-path ${manifest}' to fix`,
    );
  }
}

console.log("==> all rust checks passed");
