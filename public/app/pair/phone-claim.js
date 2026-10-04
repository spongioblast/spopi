// ABOUTME: Desktop approval for a phone that asked to pair, shown as a modal above every surface.
// ABOUTME: The decide call carries a tier. The device token is not in the response.

import { t } from "../i18n/i18n.js";
import { openDialog } from "../ui/dialog.js";
import { select } from "../ui/settings-controls.js";

/** A claim the host no longer accepts after this; the dialog closes without answering. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

const TIERS = [
  { value: "observe", key: "pair.tierObserve" },
  { value: "control", key: "pair.tierControl" },
  { value: "full", key: "pair.tierFull" },
];

/** Open request dialogs by claim id; each closes without answering. */
const open = new Map();

/**
 * @param {{ claimId?: string, name?: string, source?: string }} frame
 * @param {{ ttlMs?: number }} [options]
 */
export async function answerPhoneClaim(frame, { ttlMs = CLAIM_TTL_MS } = {}) {
  const claimId = String(frame.claimId || "");
  if (!claimId || open.has(claimId)) return;
  const answer = await askDesktop(frame, ttlMs, (dismiss) => open.set(claimId, dismiss));
  open.delete(claimId);
  if (!answer) return;
  await fetch("/api/phone/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answer.deny ? { claimId, deny: true } : { claimId, tier: answer.tier }),
  });
}

/**
 * Another window (or the host) answered this claim.
 * @param {{ claimId?: string }} frame
 */
export function closePhoneClaim(frame) {
  open.get(String(frame.claimId || ""))?.();
}

/**
 * @param {{ name?: string, source?: string }} frame
 * @param {number} ttlMs
 * @param {(dismiss: () => void) => void} onOpen
 * @returns {Promise<{ deny: boolean, tier?: string } | null>} null when the claim expired or was answered elsewhere
 */
function askDesktop(frame, ttlMs, onOpen) {
  return new Promise((resolve) => {
    /** @type {{ deny: boolean, tier?: string } | null} */
    let answer = { deny: true };
    const message = document.createElement("p");
    message.className = "dialog-message";
    message.textContent = `${t("pair.requestBody", {
      name: frame.name || "Phone",
      source: frame.source || "",
    })} ${t("pair.requestHint")}`;
    const tier = select({
      options: TIERS.map((item) => ({ value: item.value, label: t(item.key) })),
      value: "control",
      className: "ui-select phone-claim-tier",
      label: t("settings.phone.tier"),
    });
    const caption = document.createElement("span");
    caption.className = "dialog-field-label";
    caption.textContent = t("settings.phone.tier");
    const field = document.createElement("label");
    field.className = "dialog-field";
    field.append(caption, tier);
    const body = document.createElement("div");
    body.append(message, field);
    const dismiss = () => {
      answer = null;
      handle.close();
    };
    const timer = setTimeout(dismiss, ttlMs);
    const handle = openDialog({
      title: t("pair.requestTitle"),
      body,
      className: "phone-claim-dialog",
      closeOnBackdrop: false,
      actions: [
        {
          label: t("pair.deny"),
          className: "ui-button ui-button--secondary",
          onClick: () => handle.close(),
        },
        {
          label: t("pair.allow"),
          className: "ui-button ui-button--primary",
          primary: true,
          onClick: () => {
            answer = { deny: false, tier: tier.value };
            handle.close();
          },
        },
      ],
      onClose: () => {
        clearTimeout(timer);
        resolve(answer);
      },
    });
    onOpen(dismiss);
  });
}
