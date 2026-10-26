// ABOUTME: Picks the command the verify gate runs: the project's .pi/verify.json, else a detected check.
// ABOUTME: Only reads files. Running the command, and deciding whether it may run, belong to other modules.

import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_TIMEOUT_SECONDS = 300;
export const DEFAULT_MAX_REPAIRS = 2;

export type CheckCommand = {
  command: string;
  timeoutSeconds: number;
  maxRepairs: number;
  /** Where the command came from, shown to the user: ".pi/verify.json" or the detected file. */
  source: string;
};

/** Resolved setting: a command to run, or the reason there is none. */
export type CheckResolution =
  | { kind: "command"; check: CheckCommand }
  | { kind: "disabled"; source: string }
  | { kind: "none" };

const PACKAGE_SCRIPTS = ["typecheck", "type-check", "check:types", "check"];

/** `.pi/verify.json`: `{ "command": "...", "timeoutSeconds": 300, "maxRepairs": 2 }` or `{ "enabled": false }`. */
export function resolveCheckCommand(cwd: string): CheckResolution {
  const configured = readProjectConfig(cwd);
  if (configured) return configured;
  const detected = detectCheckCommand(cwd);
  return detected ? { kind: "command", check: detected } : { kind: "none" };
}

/** The secret scan runs unless `.pi/verify.json` has `"secrets": false` or `"enabled": false`. */
export function secretScanEnabled(cwd: string): boolean {
  const config = readConfigFile(cwd);
  return config?.enabled !== false && config?.secrets !== false;
}

function readConfigFile(cwd: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "verify.json"), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readProjectConfig(cwd: string): CheckResolution | null {
  const config = readConfigFile(cwd);
  if (!config) return null;
  const source = ".pi/verify.json";
  if (config.enabled === false) return { kind: "disabled", source };
  const command = typeof config.command === "string" ? config.command.trim() : "";
  if (!command) {
    const detected = detectCheckCommand(cwd);
    return detected
      ? { kind: "command", check: { ...detected, ...limits(config) } }
      : { kind: "none" };
  }
  return { kind: "command", check: { command, source, ...limits(config) } };
}

function limits(config: Record<string, unknown>) {
  return {
    timeoutSeconds: clampInteger(config.timeoutSeconds, 10, 1800, DEFAULT_TIMEOUT_SECONDS),
    maxRepairs: clampInteger(config.maxRepairs, 0, 5, DEFAULT_MAX_REPAIRS),
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Detection never installs or downloads anything: a TypeScript project without a
 * local `tsc` gets no check rather than an `npx` fetch.
 */
export function detectCheckCommand(cwd: string): CheckCommand | null {
  const defaults = { timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, maxRepairs: DEFAULT_MAX_REPAIRS };
  const scripts = readPackageScripts(cwd);
  const script = PACKAGE_SCRIPTS.find((name) => typeof scripts?.[name] === "string");
  if (script) {
    return { command: `${packageRunner(cwd)} ${script}`, source: "package.json", ...defaults };
  }
  if (exists(cwd, "tsconfig.json") && hasLocalBin(cwd, "tsc")) {
    return { command: "npx --no-install tsc --noEmit", source: "tsconfig.json", ...defaults };
  }
  if (exists(cwd, "Cargo.toml")) {
    return {
      command: "cargo check --quiet --message-format=short",
      source: "Cargo.toml",
      ...defaults,
    };
  }
  if (exists(cwd, "go.mod")) {
    return { command: "go vet ./...", source: "go.mod", ...defaults };
  }
  const python = pythonMarker(cwd);
  if (python && onPath("ruff")) {
    return { command: "ruff check --output-format=concise .", source: python, ...defaults };
  }
  return null;
}

const PYTHON_FILES = ["pyproject.toml", "ruff.toml", ".ruff.toml", "setup.py", "setup.cfg"];

/** A Python project file, or loose `.py` files at the top (scripts folders have no project file). */
function pythonMarker(cwd: string): string | null {
  const file = PYTHON_FILES.find((name) => exists(cwd, name));
  if (file) return file;
  try {
    return fs.readdirSync(cwd).some((name) => name.endsWith(".py")) ? "*.py" : null;
  } catch {
    return null;
  }
}

/** Ruff is used only when it is already installed; detection never fetches a tool. */
function onPath(name: string): boolean {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => names.some((file) => fs.existsSync(path.join(dir, file))));
}

function readPackageScripts(cwd: string): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    return pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : null;
  } catch {
    return null;
  }
}

function packageRunner(cwd: string): string {
  if (exists(cwd, "bun.lock") || exists(cwd, "bun.lockb")) return "bun run";
  if (exists(cwd, "pnpm-lock.yaml")) return "pnpm run";
  if (exists(cwd, "yarn.lock")) return "yarn run";
  return "npm run --silent";
}

function hasLocalBin(cwd: string, name: string): boolean {
  const bin = path.join(cwd, "node_modules", ".bin");
  return fs.existsSync(path.join(bin, name)) || fs.existsSync(path.join(bin, `${name}.cmd`));
}

function exists(cwd: string, name: string): boolean {
  return fs.existsSync(path.join(cwd, name));
}
