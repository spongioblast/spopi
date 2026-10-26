// ABOUTME: Tests the "Pi is not responding" notice.
// ABOUTME: Includes "shows the quiet time and restarts or waits from its buttons".
import { describe, expect, it, vi } from "vitest";
import { mountPiHungNotice } from "./pi-hung-notice.js";

describe("mountPiHungNotice", () => {
  it("shows the quiet time and restarts or waits from its buttons", async () => {
    const inputArea = document.createElement("div");
    const onRestart = vi.fn(() => Promise.resolve());
    const onWait = vi.fn();
    const t = (key, params) => (params ? `${key}:${params.seconds}` : key);
    const notice = mountPiHungNotice(inputArea, { t, onRestart, onWait });
    const element = /** @type {HTMLElement} */ (inputArea.firstElementChild);
    expect(element.classList.contains("hidden")).toBe(true);

    notice.show(61_400);
    expect(element.classList.contains("hidden")).toBe(false);
    expect(element.textContent).toContain("chat.piHung.message:61");

    const [restart, wait] = element.querySelectorAll("button");
    restart.click();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(element.textContent).toContain("chat.piHung.restarting");
    expect(wait.disabled).toBe(true);
    await vi.waitFor(() => expect(wait.disabled).toBe(false));

    wait.click();
    expect(onWait).toHaveBeenCalledOnce();
    expect(element.classList.contains("hidden")).toBe(true);
  });
});
