// ABOUTME: One registry for SPOPI shortcuts and slash commands.
// ABOUTME: The slash menu and the help overlay both read list().

/**
 * @typedef {{
 *   id: string,
 *   keys?: string,
 *   labelKey: string,
 *   when?: (event: KeyboardEvent) => boolean,
 *   run: (event?: KeyboardEvent) => boolean | void,
 * }} Keybinding
 */

/** @type {ReturnType<typeof createKeybindings> | null} */
let shared = null;
/** @type {Document | null} */
let listenedDocument = null;

/**
 * @param {string | null | undefined} keys
 * @returns {{ key: string, mod: boolean, shift: boolean, alt: boolean } | null}
 */
function parseChord(keys) {
  if (!keys) return null;
  const parts = keys.split("+").map((part) => part.trim().toLowerCase());
  const key = parts.at(-1) ?? "";
  if (!key) return null;
  return {
    key,
    mod: parts.some(
      (part) => part === "mod" || part === "ctrl" || part === "cmd" || part === "meta",
    ),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

/**
 * @param {string | null | undefined} keys
 * @returns {string}
 */
export function formatChord(keys) {
  const chord = parseChord(keys);
  if (!chord) return "";
  const mac =
    typeof navigator !== "undefined" &&
    (navigator.platform.startsWith("Mac") || navigator.userAgent.includes("Macintosh"));
  const bits = [];
  if (chord.mod) bits.push(mac ? "⌘" : "Ctrl");
  if (chord.alt) bits.push(mac ? "⌥" : "Alt");
  if (chord.shift) bits.push(mac ? "⇧" : "Shift");
  const label =
    chord.key.length === 1
      ? chord.key.toUpperCase()
      : `${chord.key.charAt(0).toUpperCase()}${chord.key.slice(1)}`;
  bits.push(label);
  return mac ? bits.join("") : bits.join("+");
}

/**
 * @param {string | null | undefined} keys
 * @param {KeyboardEvent} event
 */
function chordMatches(keys, event) {
  const chord = parseChord(keys);
  if (!chord) return false;
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (key !== chord.key) return false;
  if (Boolean(event.ctrlKey || event.metaKey) !== chord.mod) return false;
  if (chord.key !== "?" && Boolean(event.shiftKey) !== chord.shift) return false;
  if (Boolean(event.altKey) !== chord.alt) return false;
  return true;
}

export function createKeybindings() {
  /** @type {Map<string, Keybinding>} */
  const bindings = new Map();
  return {
    /**
     * @param {Keybinding} binding
     */
    register(binding) {
      bindings.set(binding.id, binding);
      return () => {
        if (bindings.get(binding.id) === binding) bindings.delete(binding.id);
      };
    },
    /**
     * @param {KeyboardEvent} event
     */
    handle(event) {
      if (!event || event.defaultPrevented || event.isComposing) return false;
      const matches = [...bindings.values()].filter((binding) => chordMatches(binding.keys, event));
      matches.sort((left, right) => specificity(right.keys) - specificity(left.keys));
      for (const binding of matches) {
        if (binding.when && !binding.when(event)) continue;
        const handled = binding.run(event);
        if (handled === false) continue;
        event.preventDefault();
        return true;
      }
      return false;
    },
    list() {
      return [...bindings.values()];
    },
  };
}

/** @param {string | null | undefined} keys */
function specificity(keys) {
  const chord = parseChord(keys);
  if (!chord) return 0;
  return (chord.mod ? 4 : 0) + (chord.alt ? 2 : 0) + (chord.shift ? 1 : 0);
}

export function appKeybindings() {
  if (!shared) shared = createKeybindings();
  return shared;
}

export function listenForKeybindings() {
  if (typeof document === "undefined" || listenedDocument === document) return;
  listenedDocument = document;
  document.addEventListener("keydown", (event) => {
    appKeybindings().handle(event);
  });
}
