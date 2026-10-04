// ABOUTME: Paints the composer guard chip and cycles the permission recipe.
// ABOUTME: Ask, Auto-edit, and Full access are pi-permission-system recipes.

import { t } from "../i18n/i18n.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";

const ORDER = ["ask", "auto-edit", "full"];

const LABELS = {
  ask: { key: "composer.guardAsk", text: "Ask" },
  "auto-edit": { key: "composer.guardAuto", text: "Auto-edit" },
  full: { key: "composer.guardFull", text: "Full access" },
};

/**
 * @typedef {{ call: (op: string, params?: Record<string, unknown>) => Promise<{ ok?: boolean, error?: string, data?: { mode?: string, stale?: boolean } } | undefined> }} GuardGateway
 */

/** @type {string} */
let mode = "ask";
let guardOpenBound = false;
/** Last permission status seen; only a mode string changes the chip. */
let lastStatus = "";
/** @type {GuardGateway | null} */
let gateway = null;

/**
 * @param {string} current
 */
export function nextGuardMode(current) {
  const index = ORDER.indexOf(current);
  return ORDER[(index + 1) % ORDER.length] || "ask";
}

function paintChip() {
  const chip = composerChromeRefs().guardChip;
  if (!(chip instanceof HTMLElement)) return null;
  const label = LABELS[/** @type {keyof typeof LABELS} */ (mode)] || LABELS.ask;
  chip.dataset.i18n = label.key;
  chip.dataset.mode = mode;
  const translated = t(label.key);
  chip.textContent = translated === label.key ? label.text : translated;
  chip.title = t("keybindings.guardCycle");
  if (!chip.dataset.guardBound) {
    chip.dataset.guardBound = "1";
    chip.addEventListener("click", () => {
      void cycleGuard();
    });
  }
  return chip;
}

/**
 * @param {unknown} next
 */
export function showGuardMode(next) {
  if (typeof next !== "string" || !ORDER.includes(next)) return;
  mode = next;
  paintChip();
}

/**
 * @param {string} next
 */
async function setGuardMode(next) {
  if (!gateway) return;
  const previous = mode;
  showGuardMode(next);
  try {
    const result = await gateway.call("set_permission_mode", { mode: next });
    if (result?.ok === false) throw new Error(result.error || "set_permission_mode failed");
    showGuardMode(result?.data?.mode);
    // Said once, when the user switches in; the chip stays orange after that.
    if (mode === "full" && previous !== "full") {
      document.dispatchEvent(
        new CustomEvent("spopi-notice", {
          detail: { message: t("composer.guardFullNote"), notifyType: "warning" },
        }),
      );
    }
  } catch (error) {
    showGuardMode(previous);
    console.warn("[guard-chip]", error);
  }
}

export function cycleGuard() {
  return setGuardMode(nextGuardMode(mode));
}

/**
 * @param {GuardGateway | null | undefined} configGateway
 */
export function mountGuardChip(configGateway) {
  gateway = configGateway ?? null;
  paintChip();
  if (!guardOpenBound) {
    guardOpenBound = true;
    document.addEventListener("spopi-open-guard", () => {
      const chip = composerChromeRefs().guardChip;
      if (chip instanceof HTMLElement) chip.click();
    });
  }
  void gateway
    ?.call("get_permission_mode")
    .then((result) => {
      showGuardMode(result?.data?.mode);
      if (result?.data?.stale !== true) return;
      document.dispatchEvent(
        new CustomEvent("spopi-notice", {
          detail: { message: t("composer.guardStale"), notifyType: "warning" },
        }),
      );
    })
    .catch((error) => console.warn("[guard-chip]", error));
}

/**
 * @param {import("../chat/transcript-reducer.js").TranscriptState | null | undefined} state
 */
export function paintGuardChip(state) {
  const raw = state?.status?.keys?.["pi-permission-system"] || "";
  if (raw !== lastStatus) {
    lastStatus = raw;
    showGuardMode(raw);
  }
  paintChip();
}
