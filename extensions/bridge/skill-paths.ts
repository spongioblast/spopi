// ABOUTME: Path helpers the skill inventory uses to match Pi's rule spelling.
// ABOUTME: Patterns stay POSIX even when the host path uses backslashes.

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { minimatch } from "minimatch";
import { toPosixPath } from "./skill-discovery.ts";

export const CONFIG_DIR_NAME = ".pi";

export function resolveLocal(input: string, baseDir: string): string {
  const expanded =
    input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
}

export function toPosix(p: string): string {
  return toPosixPath(p);
}

export function basenamePosix(p: string): string {
  const parts = toPosixPath(p).split("/");
  return parts[parts.length - 1] || "";
}

// Pi resolves skill patterns with `minimatch`; reuse it so brace/extglob and
// `**` semantics match the embedded runtime exactly.
export function globMatch(pattern: string, value: string): boolean {
  return minimatch(value, pattern);
}
