// ABOUTME: Tests createPiWatchdog with a fake clock.
// ABOUTME: Includes "does not call a long tool a hang while Pi still answers".
import { describe, expect, it, vi } from "vitest";
import { createPiWatchdog } from "./pi-watchdog.js";

function harness({ answers = true, working = true } = {}) {
  let clock = 0;
  const onHung = vi.fn();
  const onAlive = vi.fn();
  const state = { answers, working };
  const watchdog = createPiWatchdog({
    ping: () => (state.answers ? Promise.resolve({}) : new Promise(() => {})),
    isWorking: () => state.working,
    onHung,
    onAlive,
    now: () => clock,
    every: () => {},
    quietMs: 1000,
    pingMs: 50,
  });
  return {
    watchdog,
    onHung,
    onAlive,
    state,
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe("createPiWatchdog", () => {
  it("does not call a long tool a hang while Pi still answers", async () => {
    const h = harness();
    h.advance(5000);
    await h.watchdog.check();
    expect(h.onHung).not.toHaveBeenCalled();
  });

  it("reports a hang once when Pi is quiet and does not answer, and recovery on the next event", async () => {
    const h = harness({ answers: false });
    h.advance(5000);
    await h.watchdog.check();
    await h.watchdog.check();
    expect(h.onHung).toHaveBeenCalledTimes(1);
    expect(h.onHung).toHaveBeenCalledWith(5000);
    h.watchdog.noteEvent();
    expect(h.onAlive).toHaveBeenCalledOnce();
  });

  it("stays quiet before the threshold, when idle, and while snoozed", async () => {
    const h = harness({ answers: false });
    h.advance(500);
    await h.watchdog.check();
    h.state.working = false;
    h.advance(5000);
    await h.watchdog.check();
    h.state.working = true;
    h.advance(5000);
    h.watchdog.snooze(60_000);
    await h.watchdog.check();
    expect(h.onHung).not.toHaveBeenCalled();
  });
});
