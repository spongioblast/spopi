// ABOUTME: Tests that a settings change reloads Pi only after the response, and only when idle.
// ABOUTME: A busy agent keeps the restart message and the old context is not used again.

import { describe, expect, it, vi } from "vitest";
import { scheduleReload } from "./reload-after-change";

describe("scheduleReload", () => {
  it("does not reload until the caller has responded", async () => {
    const order: string[] = [];
    const ctx = {
      isIdle: () => true,
      reload: vi.fn(async () => {
        order.push("reload");
      }),
    };
    const scheduled = scheduleReload(ctx);
    expect(scheduled.reloaded).toBe(true);
    expect(ctx.reload).not.toHaveBeenCalled();
    order.push("respond");
    await scheduled.postResponse?.();
    expect(order).toEqual(["respond", "reload"]);
  });

  it("skips the reload when Pi is busy", () => {
    const ctx = { isIdle: () => false, reload: vi.fn(async () => undefined) };
    expect(scheduleReload(ctx)).toEqual({ reloaded: false });
    expect(ctx.reload).not.toHaveBeenCalled();
  });

  it("does not touch the context after reload", async () => {
    const ctx = {
      isIdle: () => true,
      async reload() {
        this.isIdle = () => {
          throw new Error("context used after reload");
        };
      },
    };
    const scheduled = scheduleReload(ctx);
    await expect(scheduled.postResponse?.()).resolves.toBeUndefined();
  });
});
