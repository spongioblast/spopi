// ABOUTME: Session list handlers return the sidebar shape from SessionManager.
// ABOUTME: A fake lister stands in for Pi so the test does not touch the agent dir.

import { describe, expect, it } from "vitest";
import { sessionListHandlers, sessionSummary } from "./session";

const created = new Date("2026-01-02T03:04:05.000Z");
const modified = new Date("2026-01-03T04:05:06.000Z");

function info(overrides: Record<string, unknown> = {}) {
  return {
    path: "C:/sessions/one.jsonl",
    id: "one",
    cwd: "C:/work/app",
    name: "Named",
    created,
    modified,
    firstMessage: "hello",
    ...overrides,
  };
}

describe("session list handlers", () => {
  it("maps a SessionManager record onto the host summary shape", () => {
    const summary = sessionSummary(info(), "ws-1", "C:/work/app");
    expect(summary).toMatchObject({
      id: "one",
      name: "Named",
      firstMessage: "hello",
      workspaceId: "ws-1",
      projectPath: "C:/work/app",
      projectName: "app",
      isCurrentWorkspace: true,
      filePath: "C:/sessions/one.jsonl",
      fileName: "one.jsonl",
      modifiedAtMs: modified.getTime(),
      activityAtMs: modified.getTime(),
    });
  });

  it("lists the current workspace and every session through the fake ctx", async () => {
    const listed = [
      info(),
      info({
        path: "C:/sessions/other.jsonl",
        id: "other",
        cwd: "C:/work/other",
        name: undefined,
        firstMessage: "",
      }),
    ];
    const handlers = sessionListHandlers({
      list: async (cwd) => listed.filter((session) => session.cwd === cwd),
    });
    const current = await handlers.list_sessions({ cwd: "C:/work/app" }, { workspaceId: "ws-1" });
    expect(current).toMatchObject({ ok: true, data: { sessions: [{ id: "one" }] } });
  });
});
