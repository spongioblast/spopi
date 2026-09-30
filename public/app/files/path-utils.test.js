// ABOUTME: Verifies cross-platform local filesystem path normalization for browser consumers.
// ABOUTME: Covers POSIX, Windows drive, UNC, basename, and parent-path behavior.
import { expect, test } from "vitest";
import {
  basenameLocalPath,
  compactWorkspaceLabel,
  displayLocalPath,
  normalizeLocalPath,
  parentLocalPath,
  parentPath,
} from "./path-utils.js";

test("normalizes Windows separators while preserving a drive root", () => {
  expect(normalizeLocalPath("C:\\Users\\Lin\\repo\\..\\spopi\\")).toBe("C:/Users/Lin/spopi");
  expect(parentLocalPath("C:\\Users\\Lin\\spopi")).toBe("C:/Users/Lin");
  expect(basenameLocalPath("C:\\Users\\Lin\\spopi\\README.md")).toBe("README.md");
});

test("normalizes UNC paths without losing the share root", () => {
  expect(normalizeLocalPath("\\\\server\\share\\repo\\src\\..\\")).toBe("//server/share/repo");
  expect(parentLocalPath("\\\\server\\share\\repo")).toBe("//server/share");
  expect(basenameLocalPath("\\\\server\\share\\repo\\file.ts")).toBe("file.ts");
});

test("takes the folder name from Windows extended UNC and drive paths", () => {
  expect(basenameLocalPath(String.raw`\\?\UNC\psf\Home\Documents\test`)).toBe("test");
  expect(basenameLocalPath(String.raw`\\?\UNC\psf\Home\Documents\New project 2`)).toBe(
    "New project 2",
  );
  expect(basenameLocalPath(String.raw`\\?\C:\Users\Lin\spopi`)).toBe("spopi");
});

test("keeps POSIX root semantics", () => {
  expect(normalizeLocalPath("/Users//Lin/../repo/")).toBe("/Users/repo");
  expect(parentLocalPath("/")).toBe("/");
  expect(basenameLocalPath("/Users/Lin/file.ts")).toBe("file.ts");
});

test("preserves relative parent traversal and normalizes empty dot segments", () => {
  expect(normalizeLocalPath("..")).toBe("..");
  expect(normalizeLocalPath("")).toBe("");
  expect(normalizeLocalPath(".")).toBe("");
  expect(normalizeLocalPath("a/./b/../c")).toBe("a/c");
  expect(parentLocalPath(".")).toBe("");
});

test("parentPath drops the last workspace-relative segment", () => {
  expect(parentPath("src/app/main.js")).toBe("src/app");
  expect(parentPath("README.md")).toBe("");
  expect(parentPath("")).toBeNull();
});

test("formats relative paths with a leading slash for sidebar display", () => {
  expect(displayLocalPath("Users/Lin/project")).toBe("/Users/Lin/project");
  expect(displayLocalPath("/Users/Lin/project")).toBe("/Users/Lin/project");
  expect(displayLocalPath("C:/Users/Lin/project")).toBe("C:/Users/Lin/project");
});

test("compacts a workspace path to the distinctive folder name", () => {
  expect(compactWorkspaceLabel("/Users/ShixinGuo/code/pi/trustMRR")).toBe("trustMRR");
  expect(compactWorkspaceLabel("C:\\Users\\Lin\\code\\pi\\spopi")).toBe("spopi");
  expect(compactWorkspaceLabel("/")).toBe("/");
  expect(compactWorkspaceLabel("")).toBe("");
});
