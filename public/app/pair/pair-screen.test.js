// ABOUTME: The pair screen posts a name and waits until the desktop decides.
// ABOUTME: Tests pair-screen.js.

import { describe, expect, it, vi } from "vitest";
import { claim, mountPairScreen } from "./pair-screen.js";

describe("pair screen", () => {
  it("mounts a name field and a pair button", () => {
    const root = document.createElement("div");
    mountPairScreen(root);
    expect(root.querySelector("input")?.getAttribute("aria-label")).toBeTruthy();
    expect(root.querySelector("button")).toBeTruthy();
  });

  it("posts a name and leaves for home when the claim is approved", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), body: init?.body });
        if (String(url) === "/pair/claim") {
          return { json: async () => ({ claimId: "claim-1" }) };
        }
        return { json: async () => ({ ok: true }) };
      }),
    );
    const assigned = [];
    const status = document.createElement("p");
    await claim("Pixel", status, (url) => assigned.push(url));
    expect(JSON.parse(calls[0].body)).toEqual({ name: "Pixel" });
    expect(calls[1].url).toBe("/pair/claim/claim-1");
    expect(assigned).toEqual(["/"]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
