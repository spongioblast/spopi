// ABOUTME: Desktop approval for a phone that asked to pair.
// ABOUTME: The decide call carries a tier. The device token is not in the response.

import { showApprovalOrDialog } from "../composer/approval-bar.js";

/**
 * @param {{ claimId?: string, name?: string, source?: string }} frame
 */
export async function answerPhoneClaim(frame) {
  const claimId = String(frame.claimId || "");
  if (!claimId) return;
  const result = await showApprovalOrDialog(
    {
      kind: "phone_claim",
      method: "phone_claim",
      title: `${frame.name || "Phone"} · ${frame.source || ""}`,
    },
    document.body,
  );
  const deny = Boolean(result?.cancelled);
  await fetch("/api/phone/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      deny ? { claimId, deny: true } : { claimId, tier: result?.value || "control" },
    ),
  });
}
