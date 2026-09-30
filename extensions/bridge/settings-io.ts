// ABOUTME: One settings.json lock, the same directory Pi's SettingsManager uses.
// ABOUTME: Bridge writers take it while a runtime is up. Rust uses it only with no runtime.

import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { stat as asyncStat, mkdir, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ConfigContext } from "./paths";
import { agentConfigPath, asString, PROJECT_CONFIG_DIR_NAME } from "./paths";

/**
 * Pi's SettingsManager.withLock calls `proper-lockfile.lockSync(path, { realpath: false })`.
 * That lock is an empty directory at `${settingsPath}.lock`. A holder is stale when the
 * directory mtime is older than 10000ms. The extension does not import proper-lockfile:
 * its graceful-fs patch breaks Pi's own lock probe inside the bun compile.
 */
const SETTINGS_LOCK_STALE_MS = 10000;
const SETTINGS_LOCK_RETRY_DELAY_MS = 20;
const SETTINGS_LOCK_MAX_ATTEMPTS = 750;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsLockDir(settingsPath: string): string {
  return `${settingsPath}.lock`;
}

/** Older Pi stored skills as `{ enableSkillCommands?, customDirectories? }`. */
export function migrateLegacySkills(settings: Record<string, unknown>): Record<string, unknown> {
  const skills = settings.skills;
  if (!isPlainObject(skills)) return settings;
  const legacy = skills as { enableSkillCommands?: unknown; customDirectories?: unknown };
  if (legacy.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
    settings.enableSkillCommands = legacy.enableSkillCommands;
  }
  if (Array.isArray(legacy.customDirectories) && legacy.customDirectories.length > 0) {
    settings.skills = legacy.customDirectories.filter(
      (entry): entry is string => typeof entry === "string",
    );
  } else {
    delete settings.skills;
  }
  return settings;
}

export function readSettingsObject(settingsPath: string): Record<string, unknown> {
  try {
    const text = readFileSync(settingsPath, "utf-8");
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      throw new Error(`Pi settings must be a JSON object: ${settingsPath}`);
    }
    return migrateLegacySkills(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      throw new Error(`Pi settings at ${settingsPath} must be valid JSON: ${error.message}`);
    }
    if (error instanceof Error && error.message.startsWith("Pi settings")) throw error;
    return {};
  }
}

export function writeSettingsAtomically(settingsPath: string, next: Record<string, unknown>): void {
  const dir = dirname(settingsPath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.spopi-settings-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tmp, settingsPath);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

export async function withSettingsLock<T>(settingsPath: string, critical: () => T): Promise<T> {
  const lockDir = settingsLockDir(settingsPath);
  mkdirSync(dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < SETTINGS_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockDir);
      try {
        return critical();
      } finally {
        await rmdir(lockDir).catch(() => undefined);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      let st: Stats | undefined;
      try {
        st = await asyncStat(lockDir);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (st.mtimeMs < Date.now() - SETTINGS_LOCK_STALE_MS) {
        await rmdir(lockDir).catch(() => undefined);
        continue;
      }
      await sleep(SETTINGS_LOCK_RETRY_DELAY_MS);
    }
  }
  throw new Error(`Timed out waiting for settings lock: ${lockDir}`);
}

/** Synchronous twin for writers that already run on the extension thread. */
export function withSettingsLockSync<T>(settingsPath: string, critical: () => T): T {
  const lockDir = settingsLockDir(settingsPath);
  mkdirSync(dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < SETTINGS_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lockDir);
      try {
        return critical();
      } finally {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // released by the other side
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        const st = statSync(lockDir);
        if (st.mtimeMs < Date.now() - SETTINGS_LOCK_STALE_MS) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      const start = Date.now();
      while (Date.now() - start < SETTINGS_LOCK_RETRY_DELAY_MS) {
        // Match Pi's synchronous retry pause inside acquireLockSyncWithRetry.
      }
    }
  }
  throw new Error(`Timed out waiting for settings lock: ${lockDir}`);
}

export function writeSettingsObject(filePath: string, settings: Record<string, unknown>): void {
  withSettingsLockSync(filePath, () => writeSettingsAtomically(filePath, settings));
}

/** Read and write inside Pi's settings lock so a second writer cannot drop a key. */
export function updateSettingsObject(
  filePath: string,
  mutate: (settings: Record<string, unknown>) => void,
): Record<string, unknown> {
  return withSettingsLockSync(filePath, () => {
    const settings = readSettingsObject(filePath);
    mutate(settings);
    writeSettingsAtomically(filePath, settings);
    return settings;
  });
}

/** Read, mutate, and write inside the lock so two writers cannot drop a field. */
export async function updateSettingsFile(
  settingsPath: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return withSettingsLock(settingsPath, () => {
    const next = mutate(readSettingsObject(settingsPath));
    writeSettingsAtomically(settingsPath, next);
    return next;
  });
}

export function readSettingsRecord(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Pi settings at ${filePath} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Pi settings must be a JSON object: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

export function readConfigFile(
  filePath: string,
  fallback: string,
): { content: string; path: string } {
  const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : fallback;
  return { content, path: filePath };
}

export function writeConfigFile(filePath: string, content: unknown): void {
  if (typeof content !== "string") throw new Error("content must be a string");
  try {
    JSON.parse(content);
  } catch (error) {
    throw new Error(
      `content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

export function readTextFile(filePath: string): { content: string; path: string; exists: boolean } {
  const exists = existsSync(filePath);
  const content = exists ? readFileSync(filePath, "utf8") : "";
  return { content, path: filePath, exists };
}

export function writeTextFile(filePath: string, content: unknown): void {
  if (typeof content !== "string") throw new Error("content must be a string");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

export function backupConfigFile(configPath: string): void {
  if (existsSync(configPath)) {
    copyFileSync(configPath, `${configPath}.bak`);
  }
}

export function resolveSettingsPath(
  scope: unknown,
  ctx: ConfigContext,
): { scope: "global" | "project"; path: string } {
  const normalizedScope = asString(scope) || "global";
  if (normalizedScope === "global") return { scope: "global", path: agentConfigPath() };
  if (normalizedScope !== "project") {
    throw new Error(`Unsupported settings scope: ${normalizedScope}`);
  }
  const cwd = asString(ctx.cwd);
  if (!cwd) throw new Error("Project settings require an active workspace");
  if (ctx.isProjectTrusted && !ctx.isProjectTrusted()) {
    throw new Error("Project settings cannot be changed until the workspace is trusted");
  }
  return {
    scope: "project",
    path: join(cwd, PROJECT_CONFIG_DIR_NAME, "settings.json"),
  };
}
