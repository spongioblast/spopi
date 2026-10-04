// ABOUTME: Tests phone-claim.js: the pair request opens in the shared dialog layer and sends the answer.
// ABOUTME: A claim nobody answers closes when the host would expire it, without a decide call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerPhoneClaim, closePhoneClaim } from "./phone-claim.js";

/** @type {Array<{ url: string, body: unknown }>} */
let calls = [];

beforeEach(() => {
  calls = [];
  const root = document.createElement("div");
  root.id = "dialog-container";
  root.className = "hidden";
  document.body.append(root);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** @param {string} key */
function button(key) {
  return /** @type {HTMLButtonElement | undefined} */ (
    [...document.querySelectorAll(".phone-claim-dialog button")].find(
      (node) => node.textContent === key,
    )
  );
}

describe("phone claim", () => {
  it("asks in the dialog layer and sends the chosen tier", async () => {
    const done = answerPhoneClaim({ claimId: "claim-a", name: "Pixel", source: "192.168.80.99" });
    const container = document.getElementById("dialog-container");
    expect(container?.classList.contains("hidden")).toBe(false);
    expect(container?.querySelector(".phone-claim-dialog")).toBeTruthy();
    const tier = /** @type {HTMLSelectElement} */ (document.querySelector(".phone-claim-tier"));
    expect(tier.value).toBe("control");
    tier.value = "full";
    button("pair.allow")?.click();
    await done;
    expect(calls).toEqual([
      { url: "/api/phone/decide", body: { claimId: "claim-a", tier: "full" } },
    ]);
    expect(container?.querySelector(".phone-claim-dialog")).toBeNull();
  });

  it("denies on Deny", async () => {
    const done = answerPhoneClaim({ claimId: "claim-b", name: "Other", source: "10.0.0.9" });
    button("pair.deny")?.click();
    await done;
    expect(calls).toEqual([{ url: "/api/phone/decide", body: { claimId: "claim-b", deny: true } }]);
  });

  it("closes an unanswered claim when it expires", async () => {
    vi.useFakeTimers();
    const done = answerPhoneClaim({ claimId: "claim-c" }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    await done;
    expect(calls).toEqual([]);
    expect(document.querySelector(".phone-claim-dialog")).toBeNull();
  });

  it("closes without answering when another window settled the claim", async () => {
    const done = answerPhoneClaim({ claimId: "claim-d", name: "Pixel" });
    expect(document.querySelector(".phone-claim-dialog")).toBeTruthy();
    closePhoneClaim({ claimId: "claim-other" });
    expect(document.querySelector(".phone-claim-dialog")).toBeTruthy();
    closePhoneClaim({ claimId: "claim-d" });
    await done;
    expect(calls).toEqual([]);
    expect(document.querySelector(".phone-claim-dialog")).toBeNull();
  });
});
