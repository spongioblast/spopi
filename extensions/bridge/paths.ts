// ABOUTME: Agent-dir paths for settings, models, and skills.
// ABOUTME: Domain modules call these functions instead of building paths themselves.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import type { CatalogRegistry } from "./model-catalog";
import type { SkillScope, SkillTarget } from "./skill-inventory";

export type ConfigContext = {
  modelRegistry?: CatalogRegistry;
  cwd?: string;
  model?: unknown;
  sessionManager?: { getSessionFile: () => string | undefined };
  navigateTree?: (
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ) => Promise<{ cancelled?: boolean } | undefined>;
  setLabel?: (entryId: string, label: string | undefined) => void;
  /** Stream an OAuth operation event to the initiating request's envelope. */
  oauthNotify?: (event: unknown) => void;
  isProjectTrusted?: () => boolean;
  isIdle?: () => boolean;
  reload?: () => Promise<void>;
  ui?: { setStatus?: (key: string, text: string | undefined) => void };
};

export type ListedSession = { path?: string };

export async function renameHistoricalSession(filePath: unknown, requestedName: unknown) {
  if (typeof filePath !== "string" || typeof requestedName !== "string") {
    throw new Error("Session path and name are required.");
  }
  const name = requestedName.trim();
  if (!name) throw new Error("Session name cannot be empty.");
  if ([...name].length > 200) throw new Error("Session name cannot exceed 200 characters.");
  if (path.extname(filePath).toLowerCase() !== ".jsonl") {
    throw new Error("Session is not available.");
  }
  let canonicalTarget: string;
  try {
    canonicalTarget = fs.realpathSync.native(filePath);
  } catch {
    throw new Error("Session is not available.");
  }
  const sessions = (await SessionManager.listAll()) as ListedSession[];
  const managed = sessions.find((session) => {
    if (typeof session.path !== "string") return false;
    try {
      return fs.realpathSync.native(session.path) === canonicalTarget;
    } catch {
      return false;
    }
  });
  if (!managed) throw new Error("Session is not available.");
  const manager = SessionManager.open(canonicalTarget);
  manager.appendSessionInfo(name);
  return { filePath: canonicalTarget, name };
}

export type SkillInventoryMutation = {
  scope?: unknown;
  target?: unknown;
  enabled?: unknown;
};

export type SpopiConfigResult =
  | { ok: true; data?: unknown; postResponse?: () => Promise<void> }
  | { ok: false; error: string };

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Pi's agent folder, read when called so PI_CODING_AGENT_DIR is honored. */
export function agentDir(): string {
  return getAgentDir();
}

export function homeDir(): string {
  return os.homedir();
}

export function modelsPrefsPath(): string {
  return path.join(agentDir(), "spopi-models.json");
}

export function agentConfigPath(): string {
  return path.join(agentDir(), "settings.json");
}

export function agentsMdPath(): string {
  return path.join(agentDir(), "AGENTS.md");
}

export function appendSystemPath(): string {
  return path.join(agentDir(), "APPEND_SYSTEM.md");
}

export function modelsConfigPath(): string {
  return path.join(agentDir(), "models.json");
}

export function authConfigPath(): string {
  return path.join(agentDir(), "auth.json");
}
export const PROJECT_CONFIG_DIR_NAME = ".pi";

export function parseSkillScope(value: unknown): SkillScope {
  if (value === "global" || value === "project") return value;
  throw new Error("Invalid skill inventory scope");
}

export function parseSkillTarget(value: unknown): SkillTarget {
  if (!value || typeof value !== "object") throw new Error("Invalid skill inventory mutation");
  const target = value as { kind?: unknown; id?: unknown };
  if (target.kind !== "skill" && target.kind !== "group") {
    throw new Error("Invalid skill inventory mutation");
  }
  if (typeof target.id !== "string" || target.id.length === 0) {
    throw new Error("Invalid skill inventory mutation");
  }
  return { kind: target.kind, id: target.id };
}

export function skillInventoryOptions(scope: SkillScope, ctx: ConfigContext) {
  const cwd = typeof ctx.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd();
  return {
    scope,
    cwd,
    agentDir: agentDir(),
    homeDir: homeDir(),
    projectTrusted: Boolean(ctx.isProjectTrusted?.()),
  };
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
