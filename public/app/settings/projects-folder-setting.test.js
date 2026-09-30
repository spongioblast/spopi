// ABOUTME: Tests the Projects folder row in Settings → General.
// ABOUTME: Loads and saves ui.projectsFolder, refuses relative paths, uses the folder picker.
import { expect, test, vi } from "vitest";
import {
  isAbsoluteFolder,
  PROJECTS_FOLDER_KEY,
  projectsFolderRow,
} from "./projects-folder-setting.js";

function preferencesWith(stored) {
  return {
    get: vi.fn().mockResolvedValue(stored),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("absolute folders are Windows drive, UNC, or POSIX paths", () => {
  expect(isAbsoluteFolder("D:\\Chats")).toBe(true);
  expect(isAbsoluteFolder("\\\\server\\share")).toBe(true);
  expect(isAbsoluteFolder("/home/ana/chats")).toBe(true);
  expect(isAbsoluteFolder("chats")).toBe(false);
  expect(isAbsoluteFolder("..\\chats")).toBe(false);
});

test("shows the saved folder and saves a trimmed absolute path", async () => {
  const preferences = preferencesWith("D:\\Old");
  const row = projectsFolderRow({ preferences, invoke: null });
  await flush();
  const input = /** @type {HTMLInputElement} */ (row.querySelector("input"));
  expect(input.value).toBe("D:\\Old");
  input.value = "  D:\\Chats  ";
  input.dispatchEvent(new Event("change"));
  expect(preferences.set).toHaveBeenCalledWith(PROJECTS_FOLDER_KEY, "D:\\Chats");
  expect(input.value).toBe("D:\\Chats");
});

test("an empty field saves the default and a relative path is refused", async () => {
  const preferences = preferencesWith(undefined);
  const row = projectsFolderRow({ preferences, invoke: null });
  const input = /** @type {HTMLInputElement} */ (row.querySelector("input"));
  const error = /** @type {HTMLElement} */ (row.querySelector(".settings-projects-folder-error"));
  input.value = "chats";
  input.dispatchEvent(new Event("change"));
  expect(preferences.set).not.toHaveBeenCalled();
  expect(error.hidden).toBe(false);
  input.value = "";
  input.dispatchEvent(new Event("change"));
  expect(preferences.set).toHaveBeenCalledWith(PROJECTS_FOLDER_KEY, "");
  expect(error.hidden).toBe(true);
});

test("Choose opens a folder picker and saves the picked folder", async () => {
  const preferences = preferencesWith(undefined);
  const invoke = vi.fn().mockResolvedValue("E:\\Picked");
  const row = projectsFolderRow({ preferences, invoke });
  const choose = /** @type {HTMLButtonElement} */ (row.querySelector("button"));
  expect(choose.hidden).toBe(false);
  choose.click();
  await flush();
  expect(invoke).toHaveBeenCalledWith("plugin:dialog|open", {
    options: { directory: true, defaultPath: undefined },
  });
  expect(preferences.set).toHaveBeenCalledWith(PROJECTS_FOLDER_KEY, "E:\\Picked");
});

test("Choose is hidden where no native picker exists", () => {
  const row = projectsFolderRow({ preferences: preferencesWith(undefined), invoke: null });
  expect(/** @type {HTMLButtonElement} */ (row.querySelector("button")).hidden).toBe(true);
});
