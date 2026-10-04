// ABOUTME: Writes Ask, Auto-edit, and Full access recipes for pi-permission-system.
// ABOUTME: One locked write per mode switch; reads report a stale recipe instead of rewriting it.

import { homedir } from "node:os";
import { join, posix } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ConfigContext } from "./paths";
import { readSettingsRecord, updateSettingsObject } from "./settings-io";
import { SCREENSHOT_TOOL } from "./spopi-screenshot";
import { UI_COPY_TOOL } from "./spopi-ui-copy";
import type { BridgeHandlers } from "./types";

type Env = Record<string, string | undefined>;

const MODES = ["ask", "auto-edit", "full"] as const;
export type PermissionMode = (typeof MODES)[number];
const STATUS_KEY = "pi-permission-system";

export function agentRoot(): string {
  return getAgentDir();
}

export function permissionConfigPath(): string {
  return join(agentRoot(), "extensions", "pi-permission-system", "config.json");
}

export function protectedRoots(): string[] {
  const roots = [join(agentRoot(), "extensions"), join(homedir(), ".pi", "agent", "extensions")];
  const install = process.env.SPOPI_INSTALL_DIR?.trim();
  if (install) roots.push(install);
  const shipped = process.env.SPOPI_PUBLIC_DIR?.trim();
  if (shipped) roots.push(shipped);
  const mirror = process.env.SPOPI_EXTENSIONS_MIRROR?.trim();
  if (mirror) roots.push(mirror);
  return roots;
}

/**
 * `C:/x`, from `C:\x`, the extended-length `\\?\C:\x`, or `C:\x\src-tauri\..` (a debug
 * build's install dir). Tool paths never use the `\\?\` or `..` spellings.
 */
export function denyRoot(root: string): string {
  const slashed = root
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "");
  const unc = slashed.startsWith("//");
  const normalized = posix.normalize(unc ? slashed.slice(1) : slashed).replace(/\/+$/, "");
  return unc ? `/${normalized}` : normalized;
}

/**
 * Write denies only. Pi still reads the shipped UI (the customize skill copies files
 * from it) and the skills in the install folder.
 */
function pathDenies(roots: string[]): Record<string, "deny"> {
  const rules: Record<string, "deny"> = {};
  for (const root of roots) {
    const normalized = denyRoot(root);
    rules[normalized] = "deny";
    rules[`${normalized}/*`] = "deny";
  }
  return rules;
}

// Auto-edit lets the model look at and click a local page without a prompt (the
// browser-check skill). Anything that can reach another site, run page JavaScript,
// or reuse a real browser profile still asks. The permission extension checks each
// command of a chain on its own, and the last matching pattern wins, so the asks
// come after the allows. A project `agent-browser.json` can set the same launch
// options as those flags, so writing it asks too.
const BROWSER_LOOK = [
  "snapshot",
  "screenshot",
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "scroll",
  "scrollintoview",
  "wait",
  "get",
  "is",
  "back",
  "forward",
  "reload",
  "close",
  "errors",
  "console",
  "set viewport",
  "set media",
  "diff screenshot",
  "diff snapshot",
  "stream status",
].map((sub) => `agent-browser ${sub} *`);
const BROWSER_LOCAL_OPEN = [
  "http://127.0.0.1:*",
  "http://127.0.0.1/*",
  "http://localhost:*",
  "http://localhost/*",
].map((url) => `agent-browser open ${url}`);
const BROWSER_ASK = [
  "agent-browser open *@*",
  "agent-browser * -p *",
  ...[
    "--profile",
    "--cdp",
    "--auto-connect",
    "--state",
    "--restore",
    "--fn",
    "--allow-file-access",
    "--extension",
    "--args",
    "--init-script",
    "--headers",
    "--proxy",
    "--executable-path",
    "--config",
    "--provider",
  ].map((flag) => `agent-browser *${flag}*`),
];

/**
 * Settings → Guard → "Live debugging by the model" gives the SPOPI window a WebView2
 * debugging port. Only that port is allowed, and only look-and-click commands: `open`,
 * `back`, and `forward` would navigate the user's window away and still ask.
 */
export function liveDebugPort(env: Env = process.env): string | null {
  const port = env.SPOPI_CDP_PORT?.trim();
  return port && /^\d+$/.test(port) ? port : null;
}

const LIVE_DEBUG_SKIP = new Set(["back", "forward"]);

function liveDebugAllows(port: string): string[] {
  const looks = BROWSER_LOOK.map((pattern) => pattern.replace(/^agent-browser /, "")).filter(
    (pattern) => !LIVE_DEBUG_SKIP.has(pattern.replace(/ \*$/, "")),
  );
  return [
    ...looks.map((pattern) => `agent-browser --cdp ${port} ${pattern}`),
    `agent-browser --cdp ${port} snapshot`,
    `agent-browser --cdp ${port} tab *`,
  ];
}

const UPGRADE_DENY = {
  "agent-browser upgrade*": "deny",
  "*agent-browser* upgrade*": "deny",
} as const;

function withUpgradeDeny<T extends Record<string, string>>(rules: T): T & typeof UPGRADE_DENY {
  return { ...rules, ...UPGRADE_DENY };
}

export function upgradeDenied(permission: Record<string, unknown>): boolean {
  const bash = asRecord(permission.bash);
  return Object.entries(UPGRADE_DENY).every(([key, state]) => bash[key] === state);
}

export function autoEditBashRules(
  env: Env = process.env,
): Record<string, "allow" | "ask" | "deny"> {
  const rules: Record<string, "allow" | "ask" | "deny"> = { "*": "ask" };
  for (const pattern of [
    ...BROWSER_LOOK,
    ...BROWSER_LOCAL_OPEN,
    "agent-browser a11y",
    "agent-browser a11y --json",
  ]) {
    rules[pattern] = "allow";
  }
  for (const pattern of BROWSER_ASK) rules[pattern] = "ask";
  const port = liveDebugPort(env);
  if (port) {
    for (const pattern of liveDebugAllows(port)) rules[pattern] = "allow";
    // The last matching pattern wins: the other risky flags ask again after the port allows.
    for (const pattern of BROWSER_ASK) {
      if (pattern.includes("--cdp")) continue;
      delete rules[pattern];
      rules[pattern] = "ask";
    }
  }
  return withUpgradeDeny(rules);
}

/**
 * Reading a skill's files is gated again by path, outside-folder, and tool rules. The
 * skill gate itself fixes its answer when a turn starts and cannot be granted for the
 * session, so an ask there repeats on every read, even after a switch to Full access.
 */
const SKILL_READS = { "*": "allow" } as const;

/** @returns the config object the permission extension loads. */
export function permissionRecipe(
  mode: PermissionMode,
  roots: string[] = protectedRoots(),
  env: Env = process.env,
): { permission: Record<string, unknown> } {
  const denies = pathDenies(roots);
  if (mode === "full") {
    // Bash is named on purpose: with only a top-level allow, the permission extension
    // warns on every session start that bash inherits it by accident.
    return {
      permission: {
        "*": "allow",
        bash: withUpgradeDeny({ "*": "allow" }),
        skill: { ...SKILL_READS },
        path_write: { ...denies },
      },
    };
  }
  if (mode === "auto-edit") {
    return {
      permission: {
        "*": "ask",
        skill: { ...SKILL_READS },
        read: "allow",
        edit: "allow",
        write: "allow",
        // Codemode and tool search reach nothing on their own: every call a script
        // makes is its own tool_call, and this extension gates nested ones too.
        codemode: "allow",
        tool_search: "allow",
        list_mcp_resources: "allow",
        list_mcp_resource_templates: "allow",
        read_mcp_resource: "allow",
        [SCREENSHOT_TOOL]: "allow",
        [UI_COPY_TOOL]: "allow",
        bash: autoEditBashRules(env),
        external_directory: "ask",
        path: { "*": "allow" },
        path_write: { "*/agent-browser.json": "ask", ...denies },
      },
    };
  }
  return {
    permission: {
      "*": "ask",
      skill: { ...SKILL_READS },
      path: { "*": "ask" },
      path_write: { ...denies },
      bash: withUpgradeDeny({ "*": "ask" }),
    },
  };
}

/** A recipe from a build before skill reads were allowed. */
export function skillReadsAsk(permission: Record<string, unknown>): boolean {
  return asRecord(permission.skill)["*"] !== "allow";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inferMode(config: Record<string, unknown>): PermissionMode {
  const permission = asRecord(config.permission);
  if (permission.read === "allow" && permission.edit === "allow" && permission.write === "allow") {
    return "auto-edit";
  }
  if (permission["*"] === "allow") return "full";
  return "ask";
}

export function readPermissionMode(): PermissionMode {
  try {
    const config = readSettingsRecord(permissionConfigPath());
    if (Object.keys(config).length === 0) return "ask";
    return inferMode(config);
  } catch {
    return "ask";
  }
}

function currentPermission(): Record<string, unknown> {
  try {
    return asRecord(readSettingsRecord(permissionConfigPath()).permission);
  } catch {
    return {};
  }
}

/** A Full access file written before bash was named keeps triggering the warning. */
function fullRecipeNeedsBash(permission: Record<string, unknown>): boolean {
  const bash = permission.bash;
  if (typeof bash === "string") return false;
  const record = asRecord(bash);
  return !Object.hasOwn(record, "*") || !upgradeDenied({ bash: record });
}

export type StaleReason =
  | "root-denies"
  | "skill-reads"
  | "upgrade-deny"
  | "full-bash"
  | "auto-edit";

/** Why the recipe on disk differs from what this build writes for its mode. */
export function staleReasons(
  mode: PermissionMode,
  permission: Record<string, unknown>,
  env: Env = process.env,
  roots: string[] = protectedRoots(),
): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (rootDeniesMissing(permission, roots)) reasons.push("root-denies");
  if (skillReadsAsk(permission)) reasons.push("skill-reads");
  if (!upgradeDenied(permission)) reasons.push("upgrade-deny");
  if (mode === "full" && fullRecipeNeedsBash(permission)) reasons.push("full-bash");
  if (mode === "auto-edit" && autoEditRecipeStale(permission, env)) reasons.push("auto-edit");
  return reasons;
}

/**
 * An Auto-edit recipe from an older SPOPI, or from a launch with a different live-debugging
 * port, lacks today's allows. SPOPI owns these recipes (every mode switch rewrites them).
 */
export function autoEditRecipeStale(
  permission: Record<string, unknown>,
  env: Env = process.env,
): boolean {
  if (permission[SCREENSHOT_TOOL] !== "allow" || permission[UI_COPY_TOOL] !== "allow") return true;
  if (!upgradeDenied(permission)) return true;
  const port = liveDebugPort(env);
  const cdpKeys = Object.keys(asRecord(permission.bash)).filter((key) =>
    /^agent-browser --cdp \d+ /.test(key),
  );
  if (!port) return cdpKeys.length > 0;
  const wanted = liveDebugAllows(port);
  return cdpKeys.length !== wanted.length || wanted.some((key) => !cdpKeys.includes(key));
}

/**
 * A recipe written before a root existed, with a `//?/` or `..` root that never matched,
 * or with the older read-and-write denies on bare `path`.
 */
export function rootDeniesMissing(
  permission: Record<string, unknown>,
  roots: string[] = protectedRoots(),
): boolean {
  const write = asRecord(permission.path_write);
  const path = asRecord(permission.path);
  return Object.keys(pathDenies(roots)).some((key) => write[key] !== "deny" || key in path);
}

function writeRecipe(mode: PermissionMode): void {
  const recipe = permissionRecipe(mode);
  updateSettingsObject(permissionConfigPath(), (config) => {
    config.permission = recipe.permission;
  });
}

function publish(ctx: ConfigContext, mode: PermissionMode): void {
  ctx.ui?.setStatus?.(STATUS_KEY, mode);
}

export const handlers: BridgeHandlers = {
  // Reading never rewrites a recipe the user may have edited. A stale one is reported,
  // and the UI offers set_permission_mode with the same mode as the repair.
  get_permission_mode: async (ctx) => {
    const mode = readPermissionMode();
    const permission = currentPermission();
    // First run: no recipe yet. The extension already asks for everything without one;
    // writing Ask adds the protected-root denies.
    if (Object.keys(permission).length === 0) {
      writeRecipe("ask");
      publish(ctx, "ask");
      return { ok: true, data: { mode: "ask", stale: false, reasons: [] } };
    }
    const reasons = staleReasons(mode, permission);
    publish(ctx, mode);
    return { ok: true, data: { mode, stale: reasons.length > 0, reasons } };
  },
  set_permission_mode: async (ctx, params) => {
    const mode = params?.mode;
    if (mode !== "ask" && mode !== "auto-edit" && mode !== "full") {
      return { ok: false, error: "mode must be ask, auto-edit, or full" };
    }
    writeRecipe(mode);
    publish(ctx, mode);
    return { ok: true, data: { mode } };
  },
};
