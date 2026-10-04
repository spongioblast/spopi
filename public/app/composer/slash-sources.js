// ABOUTME: Slash-command sources and the order they appear in the menu.
// ABOUTME: Pi built-ins, skills, prompts, extensions, then SPOPI commands.

import { t } from "../i18n/i18n.js";
import { createIcon } from "../ui/icons.js";
import { appKeybindings, formatChord } from "../ui/keybindings.js";

/**
 * @typedef {{
 *   name?: string,
 *   command?: string,
 *   description?: string,
 *   descriptionKey?: string,
 *   type?: string,
 *   source?: string,
 *   scope?: string,
 *   shortcut?: string,
 *   action?: string,
 *   passArgsToPi?: boolean,
 * }} SlashSourceCommand
 */

/** @type {SlashSourceCommand[]} */
export const PI_BUILTINS = [
  { name: "model", descriptionKey: "composer.slashMenu.cmd.model", source: "pi", type: "pi" },
  {
    name: "thinking",
    descriptionKey: "composer.slashMenu.cmd.thinking",
    source: "pi",
    type: "pi",
  },
  {
    name: "tree",
    descriptionKey: "composer.slashMenu.cmd.tree",
    source: "pi",
    type: "pi",
    action: "open_tree",
  },
  { name: "fork", descriptionKey: "composer.slashMenu.cmd.fork", source: "pi", type: "pi" },
  { name: "compact", descriptionKey: "composer.slashMenu.cmd.compact", source: "pi", type: "pi" },
  { name: "export", descriptionKey: "composer.slashMenu.cmd.export", source: "pi", type: "pi" },
];

/** @type {SlashSourceCommand[]} */
export const SPOPI_COMMANDS = [
  {
    name: "review",
    descriptionKey: "composer.slashMenu.cmd.review",
    source: "spopi",
    type: "builtin",
    action: "review",
  },
  {
    name: "focus",
    descriptionKey: "composer.slashMenu.cmd.focus",
    source: "spopi",
    type: "builtin",
    action: "focus",
  },
  {
    name: "guard",
    descriptionKey: "composer.slashMenu.cmd.guard",
    source: "spopi",
    type: "builtin",
    action: "guard",
  },
  {
    name: "cockpit",
    descriptionKey: "composer.slashMenu.cmd.cockpit",
    source: "spopi",
    type: "builtin",
    action: "cockpit",
  },
  {
    name: "mcp",
    descriptionKey: "composer.slashMenu.cmd.mcp",
    source: "spopi",
    type: "builtin",
    action: "mcp",
    passArgsToPi: true,
  },
  {
    name: "tui",
    descriptionKey: "composer.slashMenu.cmd.tui",
    source: "spopi",
    type: "builtin",
    action: "tui",
  },
  {
    name: "phone",
    descriptionKey: "composer.slashMenu.cmd.phone",
    source: "spopi",
    type: "builtin",
    action: "phone",
  },
  {
    name: "hotkeys",
    descriptionKey: "composer.slashMenu.cmd.hotkeys",
    source: "spopi",
    type: "builtin",
    action: "hotkeys",
  },
  {
    name: "worktree",
    descriptionKey: "composer.slashMenu.cmd.worktree",
    source: "extension",
    type: "extension",
  },
];

const SPOPI_NAMES = new Set(SPOPI_COMMANDS.map((command) => command.name));

/** @type {Record<string, string>} */
const SHORTCUTS = {};

/** @returns {SlashSourceCommand[]} */
export function standardBuiltIns() {
  return [...PI_BUILTINS, ...SPOPI_COMMANDS];
}

/**
 * @param {SlashSourceCommand | null | undefined} command
 * @returns {string}
 */
export function commandShortcut(command) {
  if (command?.shortcut) return command.shortcut;
  const name = String(command?.name ?? command?.command ?? "").replace(/^\//, "");
  const binding = appKeybindings()
    .list()
    .find((item) => item.id === name);
  if (binding?.keys) return formatChord(binding.keys);
  return SHORTCUTS[name] ?? "";
}

/** Display order for the menu that grows upward from the composer. */
export const MENU_GROUPS = ["pi", "skill", "prompt", "extension", "spopi"];

/**
 * @param {SlashSourceCommand} command
 * @returns {string}
 */
export function commandGroup(command) {
  const name = String(command.name ?? command.command ?? "").replace(/^\//, "");
  if (command.type === "skill" || command.source === "skill" || name.startsWith("skill:")) {
    return "skill";
  }
  if (command.type === "prompt" || command.source === "prompt") return "prompt";
  if (command.source === "pi" || command.type === "pi") return "pi";
  if (SPOPI_NAMES.has(name)) return "spopi";
  if (command.type === "extension" || command.source === "extension") return "extension";
  return "other";
}

/**
 * @param {SlashSourceCommand} command
 * @returns {boolean}
 */
export function isMenuCommand(command) {
  return MENU_GROUPS.includes(commandGroup(command));
}

/**
 * @param {SlashSourceCommand} command
 * @returns {string}
 */
export function typeLabel(command) {
  const group = commandGroup(command);
  if (group === "skill") return "Skill";
  if (group === "prompt") return "Prompt";
  if (group === "extension") return "Extension";
  if (group === "pi") return "Pi";
  if (group === "spopi") return "SPOPI";
  return "Command";
}

/**
 * @param {string} group
 * @returns {string}
 */
export function groupLabel(group) {
  if (group === "pi") return t("composer.slashMenu.pi");
  if (group === "extension") return t("nav.catalog.extensions");
  if (group === "prompt") return t("nav.prompts");
  if (group === "spopi") return t("composer.slashMenu.spopi");
  return t("nav.skills");
}

/**
 * @param {SlashSourceCommand} command
 * @returns {SVGSVGElement | HTMLElement | null}
 */
export function commandIcon(command) {
  const group = commandGroup(command);
  const name =
    group === "extension"
      ? "puzzle"
      : group === "prompt"
        ? "file-text"
        : group === "pi"
          ? "terminal"
          : "box";
  return createIcon(name);
}
