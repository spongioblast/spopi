// ABOUTME: Registers the SPOPI slash commands on the keybinding list.
// ABOUTME: Later steps replace review, focus, and guard by the same id.

import { showPiReview } from "../editor/review-pane.js";
import { showKeybindingHelp } from "../ui/keybinding-help.js";
import { appKeybindings } from "../ui/keybindings.js";
import { toggleLayoutPreset } from "./layout-preset.js";

/**
 * @param {{
 *   dock?: { setTab?: (id: string) => void } | null,
 *   shell?: { applyHidden?: (next: { sidebarHidden?: boolean, dockHidden?: boolean }) => void } | null,
 * }} hosts
 */
export function registerSpopiCommands({ dock, shell } = {}) {
  const keys = appKeybindings();
  keys.register({
    id: "review",
    keys: "",
    labelKey: "keybindings.review",
    run: () => showPiReview(),
  });
  keys.register({
    id: "focus",
    keys: "Mod+\\",
    labelKey: "keybindings.focus",
    run: () => {
      toggleLayoutPreset("", (patch) => shell?.applyHidden?.(patch));
    },
  });
  keys.register({ id: "guard", keys: "", labelKey: "keybindings.guard", run: () => {} });
  keys.register({
    id: "cockpit",
    keys: "",
    labelKey: "keybindings.cockpit",
    run: () => {
      dock?.setTab?.("cockpit");
      shell?.applyHidden?.({ dockHidden: false });
    },
  });
  keys.register({
    id: "tui",
    keys: "",
    labelKey: "keybindings.tui",
    run: () => {
      dock?.setTab?.("terminal");
      shell?.applyHidden?.({ dockHidden: false });
    },
  });
  keys.register({
    id: "phone",
    keys: "",
    labelKey: "keybindings.phone",
    run: () => document.dispatchEvent(new CustomEvent("spopi-open-phone")),
  });
  keys.register({
    id: "hotkeys",
    keys: "",
    labelKey: "keybindings.hotkeys",
    run: () => showKeybindingHelp(),
  });
}
