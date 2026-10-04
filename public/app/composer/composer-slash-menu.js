// ABOUTME: Shows the slash-command menu as the composer text changes.
// ABOUTME: Choosing an item inserts that command into the input.

import { t } from "../i18n/i18n.js";
import { openSettingsTab } from "../settings/settings-panel.js";
import {
  commandGroup,
  commandIcon,
  commandShortcut,
  groupLabel,
  isMenuCommand,
  MENU_GROUPS,
  typeLabel,
} from "./slash-sources.js";

/**
 * @typedef {{
 *   name?: string,
 *   command?: string,
 *   description?: string,
 *   descriptionKey?: string,
 *   type?: string,
 *   source?: string,
 *   scope?: string,
 *   path?: string,
 *   capabilityState?: string,
 *   compatibility?: { status?: string, message?: string },
 *   sourceInfo?: { source?: string, scope?: string, path?: string },
 * }} SlashCommand
 *
 * @typedef {SlashCommand & { command: string, group: string }} SlashMenuCommand
 *
 * @typedef {{
 *   input?: HTMLTextAreaElement | HTMLInputElement | null,
 *   container?: HTMLElement | null,
 *   commandButton?: HTMLElement | null,
 *   getCommands?: () =>
 *     | Iterable<SlashCommand>
 *     | ArrayLike<SlashCommand>
 *     | SlashCommand[]
 *     | null
 *     | undefined,
 * }} ComposerSlashMenuOptions
 */

/**
 * @param {SlashCommand | null | undefined} command
 * @returns {string}
 */
function commandInvocation(command) {
  const name = command?.name ?? command?.command ?? "";
  if (!name) return "";
  return name.startsWith("/") ? name : `/${name}`;
}

/**
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function titleCaseCommandName(name) {
  return String(name ?? "")
    .replace(/^\//, "")
    .replace(/^skill:/, "")
    .split(/[-_:\s/]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * @param {HTMLTextAreaElement | HTMLInputElement} input
 * @returns {{ query: string, end: number } | null}
 */
export function activeSlashQuery(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) return null;
  return { query: match[1].toLowerCase(), end: cursor };
}

/**
 * @param {string | null | undefined} scope
 * @returns {string}
 */
function scopeLabel(scope) {
  if (scope === "project") return t("composer.slashMenu.originProject");
  if (scope === "temporary") return t("composer.slashMenu.originTemporary");
  if (scope === "spopi") return t("composer.slashMenu.spopi");
  return t("composer.slashMenu.originPersonal");
}

/**
 * @param {SlashCommand | null | undefined} command
 * @returns {string}
 */
function commandDescription(command) {
  if (command?.descriptionKey) return t(command.descriptionKey);
  return command?.description || "";
}

/**
 * Where a command comes from: the providing package when pi reports one
 * (`npm:pi-web-access` → `pi-web-access`), otherwise the scope it was loaded
 * from (Personal/Project/Temporary) or SPOPI for built-ins.
 *
 * @param {SlashCommand | null | undefined} command
 * @returns {string}
 */
export function originLabel(command) {
  if (command?.source === "pi" || command?.type === "pi" || command?.sourceInfo?.source === "pi") {
    return t("composer.slashMenu.pi");
  }
  if (command?.source === "spopi" || command?.type === "builtin") {
    return t("composer.slashMenu.spopi");
  }
  const source = command?.sourceInfo?.source;
  if (typeof source === "string") {
    if (source.startsWith("npm:")) return source.slice(4);
    if (source === "inline") return t("composer.slashMenu.originInline");
  }
  return scopeLabel(command?.sourceInfo?.scope ?? command?.scope);
}

/**
 * True when the command is known to need the real terminal — pi-gui calls this
 * "terminal-only". SPOPI learns it the first time a command's TUI surface fails
 * to render in the WebView (see extensions/extension-command-compatibility.js).
 *
 * @param {SlashCommand | null | undefined} command
 * @returns {boolean}
 */
function isTerminalOnly(command) {
  return command?.compatibility?.status === "terminal-only";
}

/**
 * Order matches so a command whose name literally starts with the query wins
 * over one that only matched fuzzily (on its description, package, or scope),
 * and so the group holding such a match is listed first. Without this an
 * installed skill steals `/tod` from the `todos` extension command purely
 * because skills are rendered before extensions.
 *
 * @param {SlashMenuCommand[]} matches
 * @param {string} query
 * @returns {SlashMenuCommand[]}
 */
function orderSlashMatches(matches, query) {
  /**
   * @param {SlashMenuCommand} command
   * @returns {0 | 1}
   */
  const isPrefix = (command) =>
    query && command.command.slice(1).toLowerCase().startsWith(query) ? 0 : 1;
  const groupsWithPrefix = new Set(
    matches.filter((command) => isPrefix(command) === 0).map((command) => command.group),
  );
  /**
   * @param {SlashMenuCommand} command
   * @returns {number}
   */
  const groupRank = (command) =>
    MENU_GROUPS.indexOf(command.group) +
    (groupsWithPrefix.size > 0 && !groupsWithPrefix.has(command.group) ? MENU_GROUPS.length : 0);
  return matches
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        groupRank(a.command) - groupRank(b.command) ||
        isPrefix(a.command) - isPrefix(b.command) ||
        a.index - b.index,
    )
    .map((entry) => entry.command);
}

/**
 * @param {Iterable<SlashCommand> | ArrayLike<SlashCommand> | SlashCommand[] | null | undefined} commands
 * @returns {SlashMenuCommand[]}
 */
function normalizeCommands(commands) {
  return Array.from(commands ?? [])
    .filter(isMenuCommand)
    .map((command) => ({
      ...command,
      command: commandInvocation(command),
      group: commandGroup(command),
    }))
    .filter((command) => command.command && command.capabilityState !== "disabled")
    .sort((a, b) => MENU_GROUPS.indexOf(a.group) - MENU_GROUPS.indexOf(b.group));
}

/**
 * @param {ComposerSlashMenuOptions} [options]
 */
export function mountComposerSlashMenu({
  input,
  container,
  commandButton = null,
  getCommands,
} = {}) {
  if (!input || !container || typeof getCommands !== "function") {
    return { close() {}, update() {}, openAll() {} };
  }
  // Locals so nested closures keep the early-return narrowing.
  const inputEl = input;
  const containerEl = container;
  const resolveCommands = getCommands;
  const commandBtn = commandButton;

  /** @type {SlashMenuCommand[]} */
  let matches = [];
  let selectedIndex = 0;
  let open = false;
  let updateGeneration = 0;

  containerEl.setAttribute("role", "listbox");
  containerEl.setAttribute("aria-label", t("composer.slashMenu.slashCommandsLabel"));
  inputEl.setAttribute("role", "combobox");
  inputEl.setAttribute("aria-autocomplete", "list");
  inputEl.setAttribute("aria-controls", containerEl.id);
  inputEl.setAttribute("aria-expanded", "false");

  function close() {
    updateGeneration += 1;
    open = false;
    matches = [];
    selectedIndex = 0;
    containerEl.classList.add("hidden");
    containerEl.innerHTML = "";
    inputEl.removeAttribute("aria-activedescendant");
    inputEl.setAttribute("aria-expanded", "false");
  }

  function ensureSlashQuery() {
    const slash = activeSlashQuery(inputEl);
    if (slash) return slash;
    if (inputEl.value.trim().length === 0) {
      inputEl.value = "/";
      inputEl.setSelectionRange(1, 1);
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      return { query: "", end: 1 };
    }
    return null;
  }

  /**
   * @param {number} index
   */
  function select(index) {
    const command = matches[index];
    const slash = activeSlashQuery(inputEl);
    if (!command || !slash) return;
    const suffix = inputEl.value.slice(slash.end);
    const invocation = command.command;
    inputEl.value = `${invocation} ${suffix}`;
    inputEl.setSelectionRange(invocation.length + 1, invocation.length + 1);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.focus();
    close();
  }

  function updateSelection() {
    const options = containerEl.querySelectorAll(".skill-slash-option");
    options.forEach((option, index) => {
      const selected = index === selectedIndex;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", String(selected));
    });
    if (matches.length > 0) {
      inputEl.setAttribute("aria-activedescendant", `skill-slash-option-${selectedIndex}`);
      options[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }

  /**
   * @param {SlashMenuCommand} command
   * @param {string} query
   * @returns {boolean}
   */
  function commandMatches(command, query) {
    if (!query) return true;
    return [
      command.name,
      command.command,
      commandDescription(command),
      titleCaseCommandName(command.name),
      typeLabel(command),
      originLabel(command),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  }

  function render() {
    const slash = activeSlashQuery(inputEl);
    if (!slash) {
      close();
      return;
    }

    matches = orderSlashMatches(
      normalizeCommands(resolveCommands()).filter((command) =>
        commandMatches(command, slash.query),
      ),
      slash.query,
    );
    selectedIndex = Math.min(selectedIndex, Math.max(matches.length - 1, 0));

    containerEl.innerHTML = "";

    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "skill-slash-empty";
      if (slash.query) {
        empty.textContent = t("composer.slashMenu.noMatchingCommands");
      } else {
        empty.append(document.createTextNode(`${t("composer.slashMenu.noCommandsYet")} `));
        const link = document.createElement("button");
        link.type = "button";
        link.className = "skill-slash-empty-link";
        link.textContent = t("composer.slashMenu.installExtensions");
        link.addEventListener("mousedown", (event) => event.preventDefault());
        link.addEventListener("click", () => {
          close();
          openSettingsTab("extensions");
        });
        empty.append(link);
      }
      containerEl.appendChild(empty);
    } else {
      /** @type {string | null} */
      let renderedGroup = null;
      matches.forEach((command, index) => {
        if (command.group !== renderedGroup) {
          renderedGroup = command.group;
          const heading = document.createElement("div");
          heading.className = "skill-slash-heading";
          heading.setAttribute("role", "presentation");
          heading.textContent = groupLabel(renderedGroup);
          containerEl.appendChild(heading);
        }
        const option = document.createElement("button");
        option.type = "button";
        option.id = `skill-slash-option-${index}`;
        option.className = "skill-slash-option";
        option.classList.toggle("selected", index === selectedIndex);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === selectedIndex));
        const iconWrap = document.createElement("span");
        iconWrap.className = "skill-slash-icon";
        const icon = commandIcon(command);
        if (icon) iconWrap.appendChild(icon);
        option.append(
          iconWrap,
          Object.assign(document.createElement("span"), { className: "skill-slash-name" }),
          Object.assign(document.createElement("span"), { className: "skill-slash-description" }),
          Object.assign(document.createElement("span"), { className: "skill-slash-badge" }),
          Object.assign(document.createElement("span"), { className: "skill-slash-scope" }),
        );
        const nameEl = option.querySelector(".skill-slash-name");
        if (nameEl) nameEl.textContent = titleCaseCommandName(command.name);
        const descriptionEl = option.querySelector(".skill-slash-description");
        if (descriptionEl) {
          descriptionEl.textContent = commandDescription(command) || typeLabel(command);
        }
        const badge = option.querySelector(".skill-slash-badge");
        if (badge && isTerminalOnly(command)) {
          badge.textContent = t("composer.slashMenu.terminalOnly");
          if ("title" in badge) {
            badge.title = command.compatibility?.message || badge.textContent;
          }
        } else if (badge) {
          const shortcut = commandShortcut(command);
          if (shortcut) badge.textContent = shortcut;
        }
        const origin = option.querySelector(".skill-slash-scope");
        if (origin) {
          origin.textContent = originLabel(command);
          if ("title" in origin) {
            origin.title = command.sourceInfo?.path || command.path || origin.textContent;
          }
        }
        option.addEventListener("mouseenter", () => {
          selectedIndex = index;
          updateSelection();
        });
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => select(index));
        containerEl.appendChild(option);
      });
    }

    open = true;
    containerEl.classList.remove("hidden");
    inputEl.setAttribute("aria-expanded", "true");
    updateSelection();
  }

  async function update() {
    const generation = ++updateGeneration;
    if (!activeSlashQuery(inputEl)) {
      close();
      return;
    }
    await Promise.resolve();
    if (generation === updateGeneration && activeSlashQuery(inputEl)) render();
  }

  async function openAll() {
    inputEl.focus();
    if (!ensureSlashQuery()) return;
    await update();
  }

  /**
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    const isImeComposing = event.isComposing || event.keyCode === 229;
    if (isImeComposing) return;
    if (event.key === "Escape" && (open || activeSlashQuery(inputEl))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (matches.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      selectedIndex = (selectedIndex + delta + matches.length) % matches.length;
      updateSelection();
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && matches.length > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      select(selectedIndex);
    }
  }

  /**
   * @param {KeyboardEvent} event
   */
  function onDocumentKeyDown(event) {
    if (event.altKey || event.defaultPrevented || event.isComposing) return;
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    if (event.key.toLowerCase() !== "p") return;
    event.preventDefault();
    if (!containerEl.classList.contains("hidden")) {
      close();
      return;
    }
    void openAll();
  }

  inputEl.addEventListener("input", update);
  inputEl.addEventListener("focus", update);
  inputEl.addEventListener("click", update);
  inputEl.addEventListener("keydown", /** @type {EventListener} */ (onKeyDown), {
    capture: true,
  });
  inputEl.addEventListener("blur", () => queueMicrotask(close));
  commandBtn?.addEventListener("click", () => {
    void openAll();
  });
  document.addEventListener("keydown", /** @type {EventListener} */ (onDocumentKeyDown));

  return { close, update, openAll };
}
