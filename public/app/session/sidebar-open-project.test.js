// ABOUTME: Tests placeOpenProject and sameProjectPath.
// ABOUTME: The open project gets a group before its first chat is saved.
import { describe, expect, it } from "vitest";
import { placeOpenProject, sameProjectPath } from "./sidebar-open-project.js";

const open = {
  workspaceId: "ws-new",
  projectPath: "D:\\projects\\2026-09-29_10-00-00",
  projectName: "2026-09-29_10-00-00",
};

describe("placeOpenProject", () => {
  it("adds an empty current group on top when the open project has no chats", () => {
    const projects = [
      { path: "D:\\projects\\old", name: "old", isCurrent: false, sessions: [{ id: "s-1" }] },
    ];
    placeOpenProject(projects, open, new Set());
    expect(projects.map((project) => [project.name, project.isCurrent])).toEqual([
      ["2026-09-29_10-00-00", true],
      ["old", false],
    ]);
    expect(projects[0].sessions).toEqual([]);
  });

  it("marks the matching group current instead of adding a second one", () => {
    const projects = [
      { path: "d:/projects/2026-09-29_10-00-00/", name: "x", isCurrent: false, sessions: [] },
    ];
    placeOpenProject(projects, open, new Set());
    expect(projects).toHaveLength(1);
    expect(projects[0].isCurrent).toBe(true);
  });

  it("leaves the list alone when a group is already current or the project is pinned", () => {
    const current = [{ path: "D:\\projects\\old", name: "old", isCurrent: true, sessions: [] }];
    placeOpenProject(current, open, new Set());
    expect(current).toHaveLength(1);

    const pinned = [];
    placeOpenProject(pinned, open, new Set([open.projectPath]));
    expect(pinned).toHaveLength(0);
  });
});

describe("sameProjectPath", () => {
  it("ignores case, separators, and a trailing slash", () => {
    expect(sameProjectPath("D:\\Work\\App\\", "d:/work/app")).toBe(true);
    expect(sameProjectPath("D:\\Work\\App", "D:\\Work\\App2")).toBe(false);
  });
});
