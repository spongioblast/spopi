// ABOUTME: Tests hasWorkspaceHistory.
// ABOUTME: Includes "requires an enabled installed package".
import { describe, expect, it } from "vitest";
import {
  assertShadowHistory,
  filesFromHistory,
  hasWorkspaceHistory,
  historyListingCommand,
  parseChangedFiles,
  restoreCommand,
  saveCheckpointCommand,
  shadowHistoryRoot,
  workspaceHistoryCommands,
} from "./workspace-history-client.js";

describe("hasWorkspaceHistory", () => {
  it("requires an enabled installed package", () => {
    expect(hasWorkspaceHistory([])).toBe(false);
    expect(hasWorkspaceHistory([{ packageName: "pi-workspace-history", disabled: true }])).toBe(
      false,
    );
    expect(hasWorkspaceHistory([{ source: "npm:pi-workspace-history", disabled: false }])).toBe(
      true,
    );
  });
});

describe("restoreCommand", () => {
  it("uses /undo for the default files-and-conversation restore", () => {
    expect(restoreCommand()).toBe("/undo");
    expect(restoreCommand("conversation")).toBe("/undo conversation");
    expect(saveCheckpointCommand("before-refactor")).toBe("/checkpoint before-refactor");
  });
});

describe("parseChangedFiles", () => {
  it("reads status-prefixed paths", () => {
    expect(parseChangedFiles("M src/a.rs\nA src/b.rs\n")).toEqual([
      { path: "src/a.rs", status: "M" },
      { path: "src/b.rs", status: "A" },
    ]);
  });
});

describe("workspaceHistoryCommands", () => {
  it("keeps commands whose sourceInfo is pi-workspace-history", () => {
    expect(
      workspaceHistoryCommands([
        { name: "checkpoint", sourceInfo: { source: "npm:pi-workspace-history" } },
        { name: "context", sourceInfo: { source: "npm:pi-context-view" } },
        { name: "extra", sourceInfo: { source: "npm:pi-workspace-history-extra" } },
      ]),
    ).toEqual(["checkpoint"]);
    expect(
      historyListingCommand([
        { name: "checkpoint", sourceInfo: { source: "npm:pi-workspace-history" } },
      ]),
    ).toBe("");
  });
});

describe("shadowHistoryRoot", () => {
  it("points at the documented pi-workspace-history state dir", () => {
    expect(shadowHistoryRoot("C:/Users/me")).toBe("C:/Users/me/.pi/agent/state/workspace-history");
    expect(() => shadowHistoryRoot("")).toThrow(/home is missing/);
    expect(() => shadowHistoryRoot("C:/Users/../me")).toThrow(/home is missing/);
  });
});

describe("filesFromHistory", () => {
  it("uses a listing command's output when one is registered", () => {
    const files = filesFromHistory({
      commands: [{ name: "status", sourceInfo: { source: "npm:pi-workspace-history" } }],
      commandOutput: "M src/a.rs\n",
      shadowRecord: { empty: true },
    });
    expect(files).toEqual({
      source: "command",
      command: "status",
      files: [{ path: "src/a.rs", status: "M" }],
    });
  });

  it("rejects a shadow record that is not a workspace git", () => {
    expect(() =>
      filesFromHistory({ shadowRecord: { meta: { realpath: "C:/work" }, hasHead: false } }),
    ).toThrow(/no HEAD/);
    expect(() =>
      filesFromHistory({ shadowRecord: { meta: { version: 1 }, hasHead: true } }),
    ).toThrow(/no workspace path/);
  });

  it("reads files from a shadow record that names the workspace and has HEAD", () => {
    const files = filesFromHistory({
      shadowRecord: {
        meta: { realpath: "C:/work" },
        hasHead: true,
        files: [{ path: "src/a.rs", status: "M" }],
      },
    });
    expect(files.source).toBe("shadow");
    expect(files.files).toEqual([{ path: "src/a.rs", status: "M" }]);
    expect(assertShadowHistory({ empty: true })).toEqual([]);
  });
});
