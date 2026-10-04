// ABOUTME: Tests watchHostReconnect.
// ABOUTME: A reconnect clears "Disconnected"; a restarted host reloads the window.
import { describe, expect, it, vi } from "vitest";
import { watchHostReconnect } from "./host-reconnect.js";

describe("watchHostReconnect", () => {
  it("marks the window connected again after a reconnect to the same host", () => {
    const setStatus = vi.fn();
    const reload = vi.fn();
    const target = new EventTarget();
    const stop = watchHostReconnect({ setStatus, reload, target });
    target.dispatchEvent(
      new CustomEvent("spopi-host-reconnected", { detail: { restarted: false } }),
    );
    expect(setStatus).toHaveBeenCalledWith("connected");
    expect(reload).not.toHaveBeenCalled();
    stop();
    target.dispatchEvent(new CustomEvent("spopi-host-reconnected"));
    expect(setStatus).toHaveBeenCalledTimes(1);
  });

  it("reloads when the host restarted", () => {
    const setStatus = vi.fn();
    const reload = vi.fn();
    const target = new EventTarget();
    watchHostReconnect({ setStatus, reload, target });
    target.dispatchEvent(
      new CustomEvent("spopi-host-reconnected", { detail: { restarted: true } }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
