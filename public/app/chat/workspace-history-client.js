// ABOUTME: GUI over pi-workspace-history slash commands and its on-disk shadow git.
// ABOUTME: Restore/Fork never write a second snapshot store.

/**
 * @param {Array<{ packageName?: string | null, source?: string | null, disabled?: boolean }>} [packages]
 */
export function hasWorkspaceHistory(packages = []) {
  return packages.some((pkg) => {
    const name = String(pkg.packageName || pkg.source || "");
    return name.includes("pi-workspace-history") && pkg.disabled !== true;
  });
}

/** @param {string} [mode] */
export function restoreCommand(mode = "files-and-conversation") {
  if (mode === "conversation") return "/undo conversation";
  if (mode === "checkpoint") return "/checkpoint";
  return "/undo";
}

// Fork is Pi's `fork` RPC (new session), not a slash command; see turn-meta.js.
/** @param {string} [label] */
export function saveCheckpointCommand(label = "") {
  const trimmed = String(label || "").trim();
  return trimmed ? `/checkpoint ${trimmed}` : "/checkpoint";
}

/** @param {string} [listing] */
export function parseChangedFiles(listing = "") {
  return String(listing)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^[A-Z]\s+(.+)$/);
      return { path: match ? match[1] : line, status: match ? line[0] : "M" };
    });
}

/**
 * Commands whose sourceInfo belongs to pi-workspace-history.
 * A longer name such as pi-workspace-history-extra does not match.
 * @param {Array<{ name?: string, sourceInfo?: { source?: string, path?: string } }>} [commands]
 */
export function workspaceHistoryCommands(commands = []) {
  return commands
    .filter((command) => sourceIsWorkspaceHistory(command.sourceInfo))
    .map((command) => command.name)
    .filter((name) => typeof name === "string");
}

const LISTING_COMMANDS = new Set(["status", "diff", "changes", "files"]);

/**
 * A machine-readable listing command, when the package registers one.
 * checkpoint, undo, redo, rewind, and tree do not list the shadow git.
 * @param {Array<{ name?: string, sourceInfo?: { source?: string, path?: string } }>} [commands]
 */
export function historyListingCommand(commands = []) {
  return workspaceHistoryCommands(commands).find((name) => LISTING_COMMANDS.has(name)) || "";
}

/**
 * @param {{ source?: string, path?: string } | null | undefined} sourceInfo
 */
function sourceIsWorkspaceHistory(sourceInfo) {
  const source = String(sourceInfo?.source || "").replace(/^npm:/, "");
  if (source === "pi-workspace-history" || source.startsWith("pi-workspace-history@")) return true;
  const parts = String(sourceInfo?.path || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  return parts.includes("pi-workspace-history");
}

let loggedShadowRead = false;

/**
 * @param {string} [home]
 */
export function shadowHistoryRoot(home = "") {
  const base = String(home || "")
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/");
  if (!base || base === "." || base.split("/").includes("..")) {
    throw new Error("workspace-history home is missing");
  }
  return `${base}/.pi/agent/state/workspace-history`;
}

/**
 * The on-disk record must name a workspace and point at a shadow git HEAD.
 * @param {{
 *   empty?: boolean,
 *   meta?: { realpath?: unknown, cwd?: unknown } | null,
 *   hasHead?: boolean,
 *   files?: Array<{ path?: string, status?: string }>,
 * } | null | undefined} record
 */
export function assertShadowHistory(record) {
  if (record?.empty) return [];
  const meta = record?.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("workspace-history meta.json is not an object");
  }
  const folder = meta.realpath || meta.cwd;
  if (typeof folder !== "string" || !folder.trim()) {
    throw new Error("workspace-history meta.json has no workspace path");
  }
  if (record?.hasHead !== true) throw new Error("workspace-history repo.git has no HEAD");
  return Array.isArray(record.files) ? record.files : [];
}

/**
 * Prefer a listing command's output. Otherwise the caller has already read the shadow git.
 * @param {{
 *   commands?: Array<{ name?: string, sourceInfo?: { source?: string, path?: string } }>,
 *   commandOutput?: string,
 *   shadowRecord?: Parameters<typeof assertShadowHistory>[0],
 * }} [input]
 */
export function filesFromHistory({ commands = [], commandOutput = "", shadowRecord = null } = {}) {
  const listing = historyListingCommand(commands);
  if (listing) {
    return { source: "command", command: listing, files: parseChangedFiles(commandOutput) };
  }
  if (!loggedShadowRead) {
    loggedShadowRead = true;
    console.info(
      "[workspace-history] no machine-readable command lists the shadow git; reading the state directory",
    );
  }
  return { source: "shadow", command: "", files: assertShadowHistory(shadowRecord) };
}
