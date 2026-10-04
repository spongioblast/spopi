// ABOUTME: Builds the slash-command catalog and matches the text being typed.
// ABOUTME: The catalog comes from Pi plus the built-in commands.

import { standardBuiltIns } from "./slash-sources.js";

// `llama` only works in pi's TUI mode; over RPC it just warns and does nothing.
// `spopi-config` and `spopi-custom-ui` are internal data planes the WebView
// drives itself, not commands a user would type.
const HIDDEN_NATIVE_COMMANDS = new Set(["spopi-config", "spopi-custom-ui", "llama"]);

/**
 * @typedef {object} SlashCommandSourceInfo
 * @property {string} [path]
 * @property {string} [scope]
 * @property {string} [source]
 */

/**
 * @typedef {object} SlashCommand
 * @property {string} name
 * @property {string} [description]
 * @property {string} [action]
 * @property {string} [type]
 * @property {string} [source]
 * @property {string} [scope]
 * @property {string} [location]
 * @property {string} [path]
 * @property {SlashCommandSourceInfo} [sourceInfo]
 * @property {string} [capabilityState]
 * @property {boolean} [streamingCompatible]
 * @property {boolean} [passArgsToPi]
 */

/**
 * @typedef {object} BuildCommandCatalogOptions
 * @property {SlashCommand[]} [builtIns]
 * @property {SlashCommand[]} [commands]
 */

/**
 * @typedef {object} ResolveComposerInputOptions
 * @property {boolean} [working]
 * @property {boolean} [altKey]
 * @property {unknown[]} [images]
 */

/** @param {SlashCommand} command */
function commandPath(command) {
  return command.sourceInfo?.path ?? command.path;
}

/** @param {SlashCommand} command */
function inferCommandScope(command) {
  if (command.location) return command.location;
  if (command.sourceInfo?.scope) return command.sourceInfo.scope;
  const path = commandPath(command);
  if (typeof path === "string" && path.includes("/.pi/agent/")) return "global";
  return "global";
}

/** @param {SlashCommand} command */
function normalizeNativeCommand(command) {
  return {
    ...command,
    type: command.source ?? "extension",
    scope: inferCommandScope(command),
    capabilityState: command.capabilityState ?? "enabled",
  };
}

/**
 * @param {BuildCommandCatalogOptions} [options]
 * @returns {Map<string, SlashCommand>}
 */
export function buildCommandCatalog({
  builtIns = /** @type {SlashCommand[]} */ (standardBuiltIns()),
  commands = [],
} = {}) {
  /** @type {Map<string, SlashCommand>} */
  const catalog = new Map();
  for (const command of builtIns) {
    if (!command.name) continue;
    catalog.set(command.name, {
      ...command,
      type: command.type ?? "builtin",
      source: command.source ?? "spopi",
      scope: command.scope ?? "spopi",
      capabilityState: command.capabilityState ?? "enabled",
    });
  }
  for (const command of commands) {
    if (HIDDEN_NATIVE_COMMANDS.has(command.name)) continue;
    if (!catalog.has(command.name)) catalog.set(command.name, normalizeNativeCommand(command));
  }
  return catalog;
}

/**
 * Resolve the catalog entry a composer line invokes, or null when the line is
 * not a slash command SPOPI knows about. Exported so callers that need the
 * command itself (not just the intent) parse it the same way.
 * @param {unknown} input
 * @param {Map<string, SlashCommand>} catalog
 */
export function matchCatalogCommand(input, catalog) {
  const message = String(input ?? "");
  if (message.startsWith("//") || !message.startsWith("/")) return null;
  const match = /^\/([^\s]+)(?:\s+(.*))?$/s.exec(message);
  const name = match?.[1] ?? "";
  const args = match?.[2] ?? "";
  const resolvedName = name === "todo" && catalog.has("todos") ? "todos" : name;
  const command = catalog.get(resolvedName);
  return command ? { command, name, resolvedName, args } : null;
}

/**
 * @param {unknown} input
 * @param {Map<string, SlashCommand>} catalog
 * @param {ResolveComposerInputOptions} [options]
 */
export function resolveComposerInput(input, catalog, options = {}) {
  const message = String(input ?? "");
  if (message.startsWith("//")) {
    return runtimeIntent("prompt", message.slice(1), options.images);
  }
  if (message.startsWith("/")) {
    const matched = matchCatalogCommand(message, catalog);
    if (!matched) return defaultRuntimeIntent(message, options);
    const { command, name, resolvedName, args } = matched;
    if (command.capabilityState !== "enabled") {
      return { kind: "rejected", reason: `Command unavailable: /${name}` };
    }
    if (options.working && command.streamingCompatible === false) {
      return {
        kind: "rejected",
        reason: `Command cannot run while the agent is working: /${name}`,
      };
    }
    if (command.type === "builtin") {
      if (command.passArgsToPi && args.trim()) {
        return runtimeIntent("prompt", message, options.images);
      }
      return { kind: "builtin", action: command.action, arguments: args };
    }
    const runtimeMessage =
      resolvedName === name ? message : `/${resolvedName}${args ? ` ${args}` : ""}`;
    return runtimeIntent("prompt", runtimeMessage, options.images);
  }
  return defaultRuntimeIntent(message, options);
}

/**
 * @param {string} message
 * @param {ResolveComposerInputOptions} options
 */
function defaultRuntimeIntent(message, options) {
  if (!options.working) return runtimeIntent("prompt", message, options.images);
  return runtimeIntent(options.altKey ? "follow_up" : "steer", message, options.images);
}

/**
 * @param {string} type
 * @param {string} message
 * @param {unknown[] | null | undefined} [images]
 */
function runtimeIntent(type, message, images) {
  return {
    kind: "runtime",
    command: {
      type,
      message,
      ...(images?.length ? { images } : {}),
    },
  };
}
