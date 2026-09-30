// ABOUTME: Learns which extension slash commands need the real terminal.
// ABOUTME: Ported from pi-gui's per-workspace extension command compatibility.

// pi-gui classifies each extension command as "supported" or "terminal-only"
// the first time running it hits a host-UI capability the GUI cannot provide,
// then remembers that per workspace and badges the command in its slash menu.
//
// SPOPI learns the same thing from a different signal. pi-gui drives pi through
// the SDK and can throw from its own host UI; SPOPI talks to `pi --mode rpc`,
// where those capabilities are silent no-ops, so the report comes from the
// bridge extension instead (extensions/host-ui-capabilities.ts) and the command
// still runs to completion. That is the one deliberate difference from pi-gui:
// SPOPI badges and explains, it does not block the command.
//
// Attribution is a time window rather than a request id: an extension command
// executes immediately over RPC and its `prompt` response does not mark the end
// of the handler, so a report that lands shortly after a command was submitted
// is attributed to it.

import { uiStore } from "../storage/ui-store.js";

/**
 * @typedef {{
 *   name?: string,
 *   path?: string,
 *   sourceInfo?: { path?: string | null },
 * }} CompatCommand
 *
 * @typedef {{
 *   name: string,
 *   path?: string,
 *   sourceInfo?: { path?: string | null },
 * }} NamedCompatCommand
 *
 * @typedef {{
 *   commandName: string,
 *   extensionPath: string,
 *   status: string,
 *   capability: string,
 *   message: string,
 *   updatedAt: string,
 * }} CompatRecord
 *
 * @typedef {{
 *   getItem: (key: string) => string | null,
 *   setItem: (key: string, value: unknown) => void,
 *   removeItem?: (key: string) => void,
 * }} CompatStorage
 *
 * @typedef {{ command: NamedCompatCommand, at: number }} PendingCompat
 *
 * @typedef {{ message?: unknown }} CompatNotifyRequest
 */

const STORAGE_PREFIX = "ui.extensionCommandCompat";
/** How long after a submit a capability report still counts as that command's. */
const ATTRIBUTION_WINDOW_MS = 30_000;

/** Envelope key emitted by extensions/host-ui-capabilities.ts. */
const HOST_UI_CAPABILITY_KEY = "__spopiHostUi";

/**
 * @param {string} extensionPath
 * @param {string | undefined} commandName
 */
function createCompatibilityKey(extensionPath, commandName) {
  return `${extensionPath}::${commandName}`;
}

/**
 * @param {CompatCommand | null | undefined} command
 */
function commandPath(command) {
  return command?.sourceInfo?.path ?? command?.path ?? "";
}

/** Human-readable name for a `ctx.ui` capability, matching pi-gui's wording.
 * @param {unknown} capability
 */
export function capabilityLabel(capability) {
  switch (capability) {
    case "custom":
      return "custom UI";
    case "onTerminalInput":
      return "terminal input";
    case "setEditorComponent":
      return "custom editor UI";
    case "setFooter":
      return "footer UI";
    case "setHeader":
      return "header UI";
    default:
      return String(capability ?? "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase();
  }
}

/**
 * @param {string} commandName
 * @param {unknown} capability
 */
export function commandUnsupportedCapabilityMessage(commandName, capability) {
  return `/${commandName} uses terminal-only ${capabilityLabel(capability)}, which SPOPI cannot show. Run pi in a terminal for the full command.`;
}

/** Parse a bridged host-UI report; returns the capability or null.
 * @param {unknown} message
 * @returns {string | null}
 */
export function parseHostUiCapabilityFrame(message) {
  if (typeof message !== "string" || !message.includes(HOST_UI_CAPABILITY_KEY)) return null;
  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const envelope = /** @type {Record<string, unknown>} */ (payload)[HOST_UI_CAPABILITY_KEY];
  if (!envelope || typeof envelope !== "object") return null;
  const capability = /** @type {Record<string, unknown>} */ (envelope).capability;
  return typeof capability === "string" && capability ? capability : null;
}

export class ExtensionCommandCompatibility {
  /** @type {Map<string, CompatRecord>} */
  #records = new Map();
  /** @type {PendingCompat | null} */
  #pending = null;
  /** @type {CompatStorage | null} */
  #storage;
  /** @type {string} */
  #storageKey;
  /** @type {() => number} */
  #now;
  /** @type {(record: CompatRecord) => void} */
  #onLearn;

  /**
   * @param {object} [options]
   * @param {string | null | undefined} [options.workspaceId]
   * @param {CompatStorage | null | undefined} [options.storage]
   * @param {() => number} [options.now]
   * @param {(record: CompatRecord) => void} [options.onLearn]
   */
  constructor({ workspaceId, storage = uiStore, now = () => Date.now(), onLearn = () => {} } = {}) {
    this.#storage = storage ?? null;
    this.#storageKey = `${STORAGE_PREFIX}:${workspaceId ?? "default"}`;
    this.#now = now;
    this.#onLearn = onLearn;
    this.#restore();
  }

  #restore() {
    /** @type {string | null | undefined} */
    let raw;
    try {
      raw = this.#storage?.getItem(this.#storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (!entry || typeof entry !== "object") continue;
      const record = /** @type {Partial<CompatRecord>} */ (entry);
      if (!record.commandName || !record.extensionPath) continue;
      this.#records.set(
        createCompatibilityKey(record.extensionPath, record.commandName),
        /** @type {CompatRecord} */ (record),
      );
    }
  }

  #persist() {
    try {
      this.#storage?.setItem(this.#storageKey, JSON.stringify([...this.#records.values()]));
    } catch {
      // A full or unavailable store only costs us the memory of past runs.
    }
  }

  /**
   * Note that a slash command was just submitted, so a capability report
   * arriving in its wake can be attributed to it. Submitting anything else
   * (a plain prompt, an unknown command) closes the window.
   *
   * @param {CompatCommand | null | undefined} command
   */
  beginCommand(command) {
    this.#pending = command?.name
      ? { command: /** @type {NamedCompatCommand} */ (command), at: this.#now() }
      : null;
  }

  /**
   * @param {CompatCommand | null | undefined} command
   * @returns {CompatRecord | undefined}
   */
  get(command) {
    if (!command?.name) return undefined;
    return this.#records.get(createCompatibilityKey(commandPath(command), command.name));
  }

  /**
   * Attach what has been learned to each catalog command. Called on every menu
   * render so a record learned mid-session shows up without reloading the
   * command catalog.
   *
   * @param {Iterable<CompatCommand> | null | undefined} commands
   */
  decorate(commands) {
    return Array.from(commands ?? [], (command) => {
      const compatibility = this.get(command);
      return compatibility ? { ...command, compatibility } : command;
    });
  }

  /**
   * Consume a bridged host-UI capability report. Returns true when the message
   * was one, so the caller keeps it out of the transcript.
   *
   * @param {CompatNotifyRequest | null | undefined} request
   */
  consumeNotify(request) {
    const capability = parseHostUiCapabilityFrame(request?.message);
    if (!capability) return false;
    const pending = this.#pending;
    if (!pending || this.#now() - pending.at > ATTRIBUTION_WINDOW_MS) return true;

    const command = pending.command;
    const key = createCompatibilityKey(commandPath(command), command.name);
    const existing = this.#records.get(key);
    if (existing?.capability === capability) return true;

    /** @type {CompatRecord} */
    const record = {
      commandName: command.name,
      extensionPath: commandPath(command),
      status: "terminal-only",
      capability,
      message: commandUnsupportedCapabilityMessage(command.name, capability),
      updatedAt: new Date(this.#now()).toISOString(),
    };
    this.#records.set(key, record);
    this.#persist();
    this.#onLearn(record);
    return true;
  }

  /**
   * Drop records for commands pi no longer reports — an uninstalled package or
   * a renamed command should not keep a stale badge forever.
   *
   * @param {Iterable<CompatCommand> | null | undefined} commands
   */
  prune(commands) {
    const live = new Set(
      Array.from(commands ?? [], (command) =>
        createCompatibilityKey(commandPath(command), command.name),
      ),
    );
    let changed = false;
    for (const key of [...this.#records.keys()]) {
      if (live.has(key)) continue;
      this.#records.delete(key);
      changed = true;
    }
    if (changed) this.#persist();
  }
}
