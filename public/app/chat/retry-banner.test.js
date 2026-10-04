// ABOUTME: The retry banner is the only error surface for a failed turn.
// ABOUTME: Repeated messages collapse, and the banner hides when retry ends.

import { describe, expect, it } from "vitest";
import { mountRetryBanner } from "./retry-banner.js";

describe("mountRetryBanner", () => {
  it("shows one banner with a count and hides when retry ends", () => {
    const root = document.createElement("div");
    mountRetryBanner(root, {
      retry: { message: "HTTP 500" },
      count: 3,
      t: (key, params) => (key === "chat.retry.count" ? `${params?.count} failures` : key),
    });
    expect(root.hidden).toBe(false);
    expect(root.querySelectorAll(".retry-banner-message")).toHaveLength(1);
    expect(root.querySelector(".retry-banner-count")?.textContent).toBe("3 failures");
    expect(root.querySelector(".retry-banner-abort")?.classList.contains("ui-button")).toBe(true);
    mountRetryBanner(root, { retry: null });
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
  });
});
