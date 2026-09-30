// ABOUTME: Tests createSessionSelectionHandler.
// ABOUTME: Includes "switches current-workspace sessions in place".
import { describe, expect, it, vi } from "vitest";
import { createSessionSelectionHandler } from "./session-navigation.js";

describe("createSessionSelectionHandler", () => {
  it("switches current-workspace sessions in place", () => {
    const switchSession = vi.fn();
    const openSessionInProject = vi.fn();
    const selectSession = createSessionSelectionHandler({ switchSession, openSessionInProject });

    selectSession({ id: "session-2", isCurrentWorkspace: true });

    expect(switchSession).toHaveBeenCalledWith("session-2");
    expect(openSessionInProject).not.toHaveBeenCalled();
  });

  it("opens sessions from other projects in their project window", () => {
    const switchSession = vi.fn();
    const openSessionInProject = vi.fn();
    const selectSession = createSessionSelectionHandler({ switchSession, openSessionInProject });
    const session = { id: "session-3", isCurrentWorkspace: false, projectPath: "/other" };

    selectSession(session);

    expect(openSessionInProject).toHaveBeenCalledWith(session);
    expect(switchSession).not.toHaveBeenCalled();
  });

  it("shows a missing folder instead of a generic error", async () => {
    const onError = vi.fn();
    const onMissing = vi.fn();
    const openSessionInProject = vi
      .fn()
      .mockRejectedValue(new Error("Project folder no longer exists: D:\\gone"));
    const selectSession = createSessionSelectionHandler({
      openSessionInProject,
      onError,
      onMissing,
    });
    const session = { id: "session-gone", isCurrentWorkspace: false, projectPath: "D:\\gone" };

    selectSession(session);
    await Promise.resolve();
    await Promise.resolve();

    expect(onMissing).toHaveBeenCalledWith(session, expect.any(Error));
    expect(onError).not.toHaveBeenCalled();
  });

  it("routes legacy string selections as current-workspace sessions", () => {
    const switchSession = vi.fn();
    const selectSession = createSessionSelectionHandler({ switchSession });

    selectSession("session-4");

    expect(switchSession).toHaveBeenCalledWith("session-4");
  });
});
