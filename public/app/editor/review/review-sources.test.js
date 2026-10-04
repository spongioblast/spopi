// ABOUTME: Tests review scope loading for turn, session, git, and outside paths.
// ABOUTME: Gateways are mocked, including the four-at-a-time pair limit.

import { expect, test } from "vitest";
import { createReviewSources, toWorkspaceRelative } from "./review-sources.js";

test("toWorkspaceRelative strips a Windows or POSIX project root", () => {
  expect(toWorkspaceRelative("D:\\proj\\src\\a.js", "D:\\proj")).toBe("src/a.js");
  expect(toWorkspaceRelative("d:/proj/src/a.js", "D:\\proj")).toBe("src/a.js");
  expect(toWorkspaceRelative("/work/proj/src/a.js", "/work/proj")).toBe("src/a.js");
  expect(toWorkspaceRelative("D:\\other\\a.js", "D:\\proj")).toBe("D:/other/a.js");
  expect(toWorkspaceRelative("D:/proj/src/a.js", "\\\\?\\D:\\proj")).toBe("src/a.js");
});

test("load pairs a turn and names it from the snapshot index", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s", projectPath: "D:\\proj" }),
    control: {
      shadowHistoryFiles: async () => ({
        empty: false,
        meta: { cwd: "D:\\proj" },
        turn: { userEntryId: "u1", index: 14 },
        files: [{ path: "D:\\proj\\src\\a.js" }],
      }),
      shadowHistoryFilePair: async () => ({
        before: "old",
        after: "new",
        beforeExists: true,
        afterExists: true,
      }),
    },
  });
  const loaded = await sources.load("turn:u1");
  expect(loaded.label).toBe("Turn 14");
  expect(loaded.turn).toEqual({ userEntryId: "u1", index: 14 });
  expect(loaded.files[0]).toMatchObject({ path: "src/a.js", status: "M", kind: "text" });
  expect(loaded.files[0].diff.hunks.length).toBeGreaterThan(0);
});

test("an empty shadow with no meta is noHistory", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    control: { shadowHistoryFiles: async () => ({ empty: true, files: [] }) },
  });
  await expect(sources.load("session")).resolves.toMatchObject({
    label: "This session",
    unavailable: "noHistory",
    files: [],
  });
});

test("the history's own folder makes a full tool path the same file", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    control: {
      shadowHistoryFiles: async () => ({
        empty: false,
        meta: { realpath: "\\\\?\\D:\\proj" },
        turn: { userEntryId: "u1", index: 1, latest: false },
        files: [{ path: "hello.txt", status: "A" }],
      }),
      shadowHistoryFilePair: async () => ({
        before: "",
        after: "one\n",
        beforeExists: false,
        afterExists: true,
      }),
    },
  });
  const loaded = await sources.load("turn:u1", { extraPaths: ["D:/proj/hello.txt"] });
  expect(loaded.files.map((file) => file.path)).toEqual(["hello.txt"]);
});

test("files in SPOPI's UI folder are named SPOPI UI, other outside files stay outside", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s", projectPath: "D:\\proj" }),
    uiRoot: async () => "D:\\data\\spopi\\ui",
    control: { shadowHistoryFiles: async () => ({ empty: false, meta: {}, files: [] }) },
  });
  const loaded = await sources.load("session", {
    extraPaths: ["D:\\data\\spopi\\ui\\app\\theme\\themes.js", "D:\\other\\a.js", "D:\\proj\\b.js"],
  });
  expect(loaded.files.map((file) => [file.path, file.kind])).toEqual([
    ["SPOPI UI/app/theme/themes.js", "app"],
    ["D:/other/a.js", "outside"],
  ]);
});

test("a named turn the history no longer has is turnGone, not another range", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s", projectPath: "/proj" }),
    control: {
      shadowHistoryFiles: async () => ({ empty: false, meta: {}, files: [] }),
    },
  });
  await expect(sources.load("turn:old")).resolves.toMatchObject({
    label: "",
    unavailable: "turnGone",
    files: [],
  });
});

test("status comes from before and after flags when the list omits it", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s", projectPath: "/proj" }),
    control: {
      shadowHistoryFiles: async () => ({
        empty: false,
        meta: {},
        files: [{ path: "/proj/new.js" }],
      }),
      shadowHistoryFilePair: async () => ({
        before: "",
        after: "hi",
        beforeExists: false,
        afterExists: true,
      }),
    },
  });
  const loaded = await sources.load("turn");
  expect(loaded.files[0]).toMatchObject({ path: "new.js", status: "A", kind: "text" });
});

test("binary, too large, and outside paths are not fetched as text diffs", async () => {
  /** @type {string[]} */
  const fetched = [];
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s", projectPath: "D:\\proj" }),
    control: {
      shadowHistoryFiles: async () => ({
        empty: false,
        meta: {},
        files: [
          { path: "D:\\proj\\pic.png", status: "A" },
          { path: "D:\\proj\\big.js", status: "M" },
          { path: "D:\\other\\note.js" },
        ],
      }),
      shadowHistoryFilePair: async (_w, _s, path) => {
        fetched.push(path);
        if (String(path).includes("pic"))
          return { binary: true, beforeExists: false, afterExists: true };
        return { tooLarge: true, before: "a", after: "b", beforeExists: true, afterExists: true };
      },
    },
  });
  const loaded = await sources.load("turn", {
    extraPaths: ["D:\\other\\extra.js", "D:\\proj\\src\\in.js"],
  });
  expect(fetched).toEqual(["D:\\proj\\pic.png", "D:\\proj\\big.js"]);
  expect(loaded.files.map((file) => [file.path, file.kind])).toEqual([
    ["pic.png", "binary"],
    ["big.js", "tooLarge"],
    ["D:/other/note.js", "outside"],
    ["D:/other/extra.js", "outside"],
  ]);
});

test("the workspace path is the root when the history has not recorded the project", async () => {
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    projectRoot: async () => "\\\\?\\D:\\proj",
    control: {
      shadowHistoryFiles: async () => ({
        empty: false,
        meta: {},
        files: [{ path: "D:/proj/list_dir.py", status: "A" }],
      }),
      shadowHistoryFilePair: async () => ({
        before: "",
        after: "print(1)\n",
        beforeExists: false,
        afterExists: true,
      }),
    },
  });
  const loaded = await sources.load("session", { extraPaths: ["D:/proj/list_dir.py"] });
  expect(loaded.files.map((file) => [file.path, file.kind])).toEqual([["list_dir.py", "text"]]);
});

test("pair fetches stay at four at a time and duplicate paths merge", async () => {
  let active = 0;
  let max = 0;
  const sources = createReviewSources({
    getTarget: () => ({ workspaceId: "w", sessionId: "s", projectPath: "/proj" }),
    control: {
      shadowHistoryFiles: async () => ({
        empty: false,
        meta: {},
        files: [
          { path: "/proj/a.js" },
          { path: "a.js" },
          { path: "/proj/b.js" },
          { path: "/proj/c.js" },
          { path: "/proj/d.js" },
          { path: "/proj/e.js" },
        ],
      }),
      shadowHistoryFilePair: async () => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return { before: "a", after: "b", beforeExists: true, afterExists: true };
      },
    },
  });
  const loaded = await sources.load("session");
  expect(loaded.files.map((file) => file.path)).toEqual(["a.js", "b.js", "c.js", "d.js", "e.js"]);
  expect(max).toBeLessThanOrEqual(4);
  expect(max).toBeGreaterThan(1);
});

test("git scope reads HEAD against the working tree and skips conflicts", async () => {
  const sources = createReviewSources({
    isGitRepo: () => true,
    files: {
      readFile: async (path) => ({
        content: path === "new.js" ? "created" : "edited",
        isBinary: false,
      }),
    },
    git: {
      status: async () => ({
        entries: [
          { displayPath: "new.js", entryKind: "untracked", pathBytesBase64: "new" },
          { displayPath: "gone.js", xy: "D.", pathBytesBase64: "gone" },
          { displayPath: "both.js", entryKind: "unmerged", xy: "UU" },
          { displayPath: "edit.js", xy: " M", pathBytesBase64: "edit" },
        ],
      }),
      fileAtHeadText: async (id) => ({
        content: id === "gone" ? "was" : "old",
        exists: true,
        binary: false,
      }),
    },
  });
  const loaded = await sources.load("git");
  expect(loaded.label).toBe("Working tree");
  expect(loaded.files.map((file) => [file.path, file.status])).toEqual([
    ["new.js", "A"],
    ["gone.js", "D"],
    ["edit.js", "M"],
  ]);
  expect(loaded.files[0].before).toBe("");
  expect(loaded.files[1].after).toBe("");
});

test("a folder that is not a git repo reports noGit", async () => {
  const sources = createReviewSources({ isGitRepo: () => false });
  await expect(sources.load("git")).resolves.toMatchObject({ unavailable: "noGit", files: [] });
  const failing = createReviewSources({
    git: {
      status: async () => {
        throw new Error("fatal: not a git repository (or any of the parent directories)");
      },
    },
  });
  await expect(failing.load("git")).resolves.toMatchObject({ unavailable: "noGit" });
});
